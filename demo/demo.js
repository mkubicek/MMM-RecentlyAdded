/* Just enough of MagicMirror² (Module.register, updateDom, moment) to run the real module
 * front end against the demo server's made-up library.
 * URL options: ?active=4 starts on that cover, ?cycle=4000 changes the cover time in ms. */
(function () {
	"use strict";
	var definition = null;

	window.Module = {
		register: function (name, module) {
			definition = module;
		}
	};

	// The subset of moment.js the module uses: format("HH:mm"), startOf("day"), diff(other, "days").
	window.moment = function (value) {
		var date = value === undefined ? new Date() : new Date(value);
		return {
			date: date,
			format: function () {
				return ("0" + date.getHours()).slice(-2) + ":" + ("0" + date.getMinutes()).slice(-2);
			},
			startOf: function () {
				return window.moment(new Date(date.getFullYear(), date.getMonth(), date.getDate()));
			},
			diff: function (other) {
				return Math.round((date - other.date) / 86400000);
			}
		};
	};

	window.RecentlyAddedDemo = {
		start: function () {
			var params = new URLSearchParams(location.search);
			var module = Object.create(definition);
			module.identifier = "demo";
			module.config = Object.assign({}, definition.defaults, { sleep: null });
			if (params.get("cycle")) module.config.cycleInterval = +params.get("cycle");
			module.file = function (name) { return "/" + name; };
			module.show = module.hide = function () {};
			module.updateDom = function () {
				var content = document.getElementById("content");
				content.innerHTML = "";
				content.appendChild(module.getDom());
			};
			module.sendSocketNotification = function () {
				fetch("/data").then(function (response) { return response.json(); }).then(function (items) {
					module.socketNotificationReceived("RA_DATA", { id: "demo", items: items });
					if (params.get("active")) module.showCover(+params.get("active") % items.length);
				});
			};
			module.start();
			this.module = module;
		}
	};
}());
