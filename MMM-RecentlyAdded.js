/* global Module, moment */
/* MagicMirror² module: MMM-RecentlyAdded
 *
 * What's new to watch: recent Radarr movies and Sonarr shows in one cover flow, newest first.
 *
 * MIT Licensed.
 */

Module.register("MMM-RecentlyAdded", {
	defaults: {
		radarr: null, // { url: "http://host:7878", apiKey: "..." }
		sonarr: null, // { url: "http://host:8989", apiKey: "..." }

		days: 7,
		maxItems: 8,
		sideCovers: 2,
		newFor: 24 * 60 * 60 * 1000,

		cycleInterval: 10 * 1000,
		updateInterval: 5 * 60 * 1000,

		// Local times with no animation, e.g. while the screen is off: { from: "23:00", to: "06:00" }.
		sleep: null
	},

	items: [],
	activeIndex: 0,
	loaded: false,
	covers: [],
	copies: [],
	cycler: null,

	getStyles: function () {
		return [this.file("MMM-RecentlyAdded.css")];
	},

	getScripts: function () {
		return ["moment.js"];
	},

	start: function () {
		this.sendSocketNotification("RA_CONFIG", { id: this.identifier, config: this.config });
		this.startCycle();
	},

	suspend: function () {
		this.stopCycle();
	},

	resume: function () {
		this.startCycle();
	},

	startCycle: function () {
		this.stopCycle();
		this.cycler = setInterval(() => this.tick(), this.config.cycleInterval);
	},

	stopCycle: function () {
		clearInterval(this.cycler);
	},

	socketNotificationReceived: function (notification, payload) {
		if (notification !== "RA_DATA" || payload.id !== this.identifier) return;

		const activeKey = this.items[this.activeIndex] && this.items[this.activeIndex].key;
		const oldKeys = this.items.map((item) => item.key);
		const arrived = payload.items.filter((item) => oldKeys.indexOf(item.key) === -1);

		this.items = payload.items;

		// Stay on the same cover across refreshes; a new arrival swings to the front right after.
		const keys = this.items.map((item) => item.key);
		this.activeIndex = Math.max(0, keys.indexOf(activeKey));
		this.updateDom(0);
		if (this.loaded && arrived.length) setTimeout(() => this.showCover(0), 1000);
		this.loaded = true;

		if (this.items.length) {
			this.show(0, { lockString: this.identifier });
		} else {
			this.hide(0, { lockString: this.identifier });
		}
	},

	tick: function () {
		if (this.isSleeping() || this.items.length < 2) return;
		this.showCover((this.activeIndex + 1) % this.items.length);
	},

	isSleeping: function () {
		const sleep = this.config.sleep;
		if (!sleep) return false;
		const now = moment().format("HH:mm");
		return sleep.from <= sleep.to ? now >= sleep.from && now < sleep.to : now >= sleep.from || now < sleep.to;
	},

	showCover: function (index) {
		this.activeIndex = index;
		this.placeCovers();
	},

	// Cover flow: the active poster sits flat on the right, the next ones queue up to its left,
	// tilted and darkened, and the one just shown swings out to the right.
	placeCovers: function () {
		const count = this.covers.length;
		// The stylesheet has up to three side positions.
		const side = Math.min(this.config.sideCovers, 3, count - 1);
		const hasExit = count > side + 1;

		for (let i = 0; i < count; i++) {
			const offset = (this.activeIndex - i + count) % count;
			const queue = (i - this.activeIndex + count) % count;
			let position;
			if (offset === 0) {
				position = "active";
			} else if (hasExit && offset === 1) {
				position = "exit";
			} else {
				position = queue <= side ? "side-" + queue : "hidden";
			}

			const cover = this.covers[i];
			if (cover.className === "cover cover-exit" && position !== "exit") {
				// Jump back to the far left unseen instead of sweeping across the stage.
				cover.style.transition = "none";
				cover.className = "cover cover-hidden";
				void cover.offsetWidth;
				cover.style.transition = "";
			}
			cover.className = "cover cover-" + position;
			this.copies[i].className = "copy" + (offset === 0 ? " is-active" : "");
		}

		if (this.copies[this.activeIndex]) this.refreshCopy(this.activeIndex);
	},

	// Relative dates go stale while the DOM is kept, so refresh them whenever a cover comes up.
	refreshCopy: function (index) {
		const item = this.items[index];
		const copy = this.copies[index];
		copy.querySelector(".added").textContent = this.formatAdded(item.added);
		copy.querySelector(".new-dot").hidden = Date.now() - new Date(item.added).getTime() > this.config.newFor;
	},

	formatAdded: function (date) {
		const days = moment().startOf("day").diff(moment(date).startOf("day"), "days");
		if (days <= 0) return "Today";
		if (days === 1) return "Yesterday";
		return days + " days ago";
	},

	getDom: function () {
		const wrapper = document.createElement("div");
		wrapper.className = "recently-added";

		this.covers = [];
		this.copies = [];

		if (this.items.length) wrapper.appendChild(this.renderCoverflow());

		this.placeCovers();
		// MagicMirror inserts the wrapper right after getDom; measure once it's laid out in the real font.
		const copies = this.copies;
		document.fonts.ready.then(() => requestAnimationFrame(() => this.fitCopies(copies)));
		return wrapper;
	},

	// A title that wraps to two lines takes the overview's second line, so the copy keeps
	// fitting beside the poster. A data attribute, because placeCovers rewrites className.
	fitCopies: function (copies) {
		copies.forEach((copy) => {
			const title = copy.querySelector(".title .text");
			const lineHeight = parseFloat(getComputedStyle(title).lineHeight);
			if (title.offsetHeight > lineHeight * 1.5) copy.dataset.longTitle = "";
			else delete copy.dataset.longTitle;
		});
	},

	renderCoverflow: function () {
		const coverflow = document.createElement("div");
		coverflow.className = "coverflow";
		const stage = document.createElement("div");
		stage.className = "cover-stage";
		const copyStage = document.createElement("div");
		copyStage.className = "copy-stage";

		this.items.forEach((item) => {
			const cover = document.createElement("div");
			const img = document.createElement("img");
			img.decoding = "async";
			img.alt = "";
			img.onerror = () => img.remove();
			img.src = item.poster;
			cover.appendChild(img);
			stage.appendChild(cover);
			this.covers.push(cover);

			const copy = document.createElement("div");
			copy.appendChild(this.element("div", "title bright", null, [this.element("span", "text", item.title), this.element("span", "new-dot")]));
			copy.appendChild(this.element("div", "meta", item.meta));
			if (item.overview) copy.appendChild(this.element("div", "overview light", item.overview));
			copy.appendChild(this.element("div", "added"));
			copyStage.appendChild(copy);
			this.copies.push(copy);
		});

		coverflow.appendChild(stage);
		coverflow.appendChild(copyStage);
		return coverflow;
	},

	element: function (tag, className, text, children) {
		const element = document.createElement(tag);
		element.className = className;
		if (text) element.textContent = text;
		(children || []).forEach((child) => element.appendChild(child));
		return element;
	}
});
