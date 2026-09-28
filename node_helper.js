/* MagicMirror² module: MMM-RecentlyAdded
 *
 * Fetches recent Radarr and Sonarr imports server-side, so the mirror page only ever talks to
 * its own origin. Posters are proxied and kept in memory.
 *
 * MIT Licensed.
 */

const NodeHelper = require("node_helper");
const Log = require("logger");
const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");

const DAY = 24 * 60 * 60 * 1000;

// MagicMirror sends config.js to every browser that opens the mirror, so API keys can live here
// instead, readable only by the helper: { "radarr": { "apiKey": "..." }, "sonarr": { ... } }.
const SECRETS = path.join(os.homedir(), ".config", "MMM-RecentlyAdded", "secrets.json");

module.exports = NodeHelper.create({
	start: function () {
		this.pollers = {}; // module identifier -> { config, timer, payload }
		this.posters = {}; // "radarr/874" -> { type, body }

		this.expressApp.get("/" + this.name + "/poster/:source/:id", (req, res) => this.servePoster(req, res));
	},

	socketNotificationReceived: function (notification, payload) {
		if (notification !== "RA_CONFIG") return;

		const poller = this.pollers[payload.id];
		if (poller) {
			// Another browser (or a reload) joined: give it what we already have.
			if (poller.payload) this.sendSocketNotification("RA_DATA", poller.payload);
			return;
		}

		const newPoller = { config: this.withSecrets(payload.config), timer: null, payload: null };
		this.pollers[payload.id] = newPoller;
		const refresh = () => this.refresh(payload.id, newPoller);
		refresh();
		newPoller.timer = setInterval(refresh, newPoller.config.updateInterval);
	},

	// Values in config.js win; the secrets file fills in what's missing (typically just the keys).
	withSecrets: function (config) {
		let local = {};
		try {
			local = JSON.parse(fs.readFileSync(SECRETS, "utf8"));
		} catch (error) {
			if (error.code !== "ENOENT") Log.error(this.name + ": cannot read " + SECRETS + ": " + error.message);
		}
		const merged = Object.assign({}, config);
		["radarr", "sonarr"].forEach((source) => {
			if (local[source] || config[source]) merged[source] = Object.assign({}, local[source], config[source]);
			if (merged[source] && !merged[source].url) merged[source] = null;
		});
		return merged;
	},

	refresh: function (id, poller) {
		const config = poller.config;
		const since = new Date(Date.now() - config.days * DAY).toISOString();

		Promise.all([
			config.radarr ? this.fetchMovies(config.radarr, since) : [],
			config.sonarr ? this.fetchShows(config.sonarr, since) : []
		])
			.then(([movies, shows]) => {
				const items = movies.concat(shows)
					.sort((a, b) => (a.added < b.added ? 1 : -1))
					.slice(0, config.maxItems);
				const payload = { id: id, items: items };

				// Only wake the page up when something actually changed.
				if (poller.payload && JSON.stringify(payload) === JSON.stringify(poller.payload)) return;
				poller.payload = payload;
				this.prunePosters();
				this.sendSocketNotification("RA_DATA", payload);
			})
			.catch((error) => Log.error(this.name + ": refresh failed: " + error.message));
	},

	fetchMovies: function (radarr, since) {
		return this.getJson(radarr, "/api/v3/history/since?eventType=3&includeMovie=true&date=" + since).then((records) => {
			const movies = {};
			records.forEach((record) => {
				const movie = record.movie;
				// Upgrades import the same movie again; keep the latest.
				if (movies[movie.id] && movies[movie.id].added > record.date) return;
				const meta = [];
				if (movie.year) meta.push(movie.year);
				if (movie.runtime) meta.push(formatRuntime(movie.runtime));
				if (movie.ratings && movie.ratings.imdb && movie.ratings.imdb.value) meta.push("★ " + movie.ratings.imdb.value);
				movies[movie.id] = {
					key: "movie-" + movie.id,
					title: movie.title,
					meta: meta.join(" · "),
					overview: movie.overview || "",
					added: record.date,
					poster: this.posterUrl("radarr", movie.id)
				};
			});
			return Object.keys(movies).map((id) => movies[id]);
		});
	},

	fetchShows: function (sonarr, since) {
		return this.getJson(sonarr, "/api/v3/history/since?eventType=3&includeSeries=true&includeEpisode=true&date=" + since).then((records) => {
			// One cover per show, however many of its episodes arrived.
			const shows = {};
			records.forEach((record) => {
				const show = shows[record.series.id] || (shows[record.series.id] = { series: record.series, episodes: {}, added: record.date });
				show.episodes[record.episode.id] = record.episode;
				if (record.date > show.added) show.added = record.date;
			});
			return Object.keys(shows).map((id) => {
				const show = shows[id];
				const episodes = Object.keys(show.episodes).map((key) => show.episodes[key]);
				return {
					key: "series-" + show.series.id,
					title: show.series.title,
					meta: describeEpisodes(episodes),
					// One episode tells its own story; several get the show's.
					overview: (episodes.length === 1 && episodes[0].overview) || show.series.overview || "",
					added: show.added,
					poster: this.posterUrl("sonarr", show.series.id)
				};
			});
		});
	},

	posterUrl: function (source, id) {
		return this.name + "/poster/" + source + "/" + id;
	},

	servePoster: function (req, res) {
		const source = req.params.source;
		const id = req.params.id;
		const key = source + "/" + id;
		const server = this.serverFor(source);
		if (!server || !/^\d+$/.test(id)) return res.sendStatus(404);

		const send = (poster) => {
			res.set("Content-Type", poster.type);
			res.set("Cache-Control", "public, max-age=604800");
			res.send(poster.body);
		};
		if (this.posters[key]) return send(this.posters[key]);

		this.get(server, "/api/v3/mediacover/" + id + "/poster-250.jpg")
			.then((response) => {
				const poster = { type: response.type || "image/jpeg", body: response.body };
				this.posters[key] = poster;
				send(poster);
			})
			.catch(() => res.sendStatus(404));
	},

	serverFor: function (source) {
		if (source !== "radarr" && source !== "sonarr") return null;
		const ids = Object.keys(this.pollers);
		for (let i = 0; i < ids.length; i++) {
			if (this.pollers[ids[i]].config[source]) return this.pollers[ids[i]].config[source];
		}
		return null;
	},

	// Keep only posters that are still on screen.
	prunePosters: function () {
		const used = {};
		Object.keys(this.pollers).forEach((id) => {
			const payload = this.pollers[id].payload;
			if (payload) payload.items.forEach((item) => (used[item.poster.split("/poster/")[1]] = true));
		});
		Object.keys(this.posters).forEach((key) => {
			if (!used[key]) delete this.posters[key];
		});
	},

	getJson: function (server, path) {
		return this.get(server, path).then((response) => JSON.parse(response.body.toString("utf8")));
	},

	get: function (server, path) {
		const url = new URL(server.url.replace(/\/+$/, "") + path);
		const client = url.protocol === "https:" ? https : http;
		return new Promise((resolve, reject) => {
			const request = client.get(url, { headers: { "X-Api-Key": server.apiKey }, timeout: 15000 }, (response) => {
				const chunks = [];
				response.on("data", (chunk) => chunks.push(chunk));
				response.on("end", () => {
					if (response.statusCode !== 200) return reject(new Error(url.pathname + " returned " + response.statusCode));
					resolve({ type: response.headers["content-type"], body: Buffer.concat(chunks) });
				});
			});
			request.on("timeout", () => request.destroy(new Error(url.pathname + " timed out")));
			request.on("error", reject);
		});
	}
});

function pad(number) {
	return number < 10 ? "0" + number : String(number);
}

function formatRuntime(minutes) {
	const hours = Math.floor(minutes / 60);
	return hours > 0 ? hours + "h " + (minutes % 60) + "m" : minutes + "m";
}

// "S04E08 · Follow the Anger", "3 new episodes · S04E06–08", "2 new episodes · Season 4", ...
function describeEpisodes(episodes) {
	episodes.sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
	const first = episodes[0];
	const last = episodes[episodes.length - 1];
	if (episodes.length === 1) return "S" + pad(first.seasonNumber) + "E" + pad(first.episodeNumber) + " · " + first.title;

	let range;
	if (first.seasonNumber !== last.seasonNumber) {
		range = "Seasons " + first.seasonNumber + "–" + last.seasonNumber;
	} else if (last.episodeNumber - first.episodeNumber === episodes.length - 1) {
		range = "S" + pad(first.seasonNumber) + "E" + pad(first.episodeNumber) + "–" + pad(last.episodeNumber);
	} else {
		range = "Season " + first.seasonNumber;
	}
	return episodes.length + " new episodes · " + range;
}
