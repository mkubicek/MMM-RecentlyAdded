"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

// Load node_helper.js with MagicMirror's `node_helper` and `logger` stubbed, and HOME pointed at a
// temporary directory so the secrets file is under the test's control.
function loadHelper(secrets) {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "ra-home-"));
	if (secrets) {
		fs.mkdirSync(path.join(home, ".config", "MMM-RecentlyAdded"), { recursive: true });
		fs.writeFileSync(path.join(home, ".config", "MMM-RecentlyAdded", "secrets.json"), JSON.stringify(secrets));
	}
	const originalLoad = Module._load;
	const originalHome = process.env.HOME;
	process.env.HOME = home;
	Module._load = function (request) {
		if (request === "node_helper") return { create: (definition) => Object.assign({ name: "MMM-RecentlyAdded" }, definition) };
		if (request === "logger") return { error() {}, log() {} };
		return originalLoad.apply(this, arguments);
	};
	try {
		delete require.cache[require.resolve("../node_helper")];
		return require("../node_helper");
	} finally {
		Module._load = originalLoad;
		process.env.HOME = originalHome;
	}
}

function stubApi(helper, responses) {
	helper.getJson = (server, apiPath) => Promise.resolve(responses[server.name](apiPath));
	return helper;
}

const radarr = { name: "radarr", url: "http://radarr.local:7878", apiKey: "r" };
const sonarr = { name: "sonarr", url: "http://sonarr.local:8989", apiKey: "s" };

test("movies: one entry per movie, the latest import wins, meta is year · runtime · rating", async () => {
	const helper = stubApi(loadHelper(), {
		radarr: () => [
			{ date: "2026-09-20T10:00:00Z", movie: { id: 7, title: "The Quiet Harbour", year: 2025, runtime: 112, overview: "o", ratings: { imdb: { value: 7.8 } } } },
			{ date: "2026-09-22T10:00:00Z", movie: { id: 7, title: "The Quiet Harbour", year: 2025, runtime: 112, overview: "o", ratings: { imdb: { value: 7.8 } } } },
			{ date: "2026-09-21T10:00:00Z", movie: { id: 8, title: "Short", runtime: 45 } }
		]
	});
	const movies = await helper.fetchMovies(radarr, "2026-09-15T00:00:00Z");
	assert.deepEqual(movies.map((m) => [m.title, m.meta, m.added]), [
		["The Quiet Harbour", "2025 · 1h 52m · ★ 7.8", "2026-09-22T10:00:00Z"],
		["Short", "45m", "2026-09-21T10:00:00Z"]
	]);
	assert.equal(movies[0].poster, "MMM-RecentlyAdded/poster/radarr/7");
});

function episode(id, season, number, title, date, overview) {
	return { date: date || "2026-09-20T10:00:00Z", series: { id: 3, title: "Northern Lines", overview: "show" }, episode: { id: id, seasonNumber: season, episodeNumber: number, title: title, overview: overview } };
}

test("shows: one cover per show, episodes summarised", async () => {
	const cases = [
		[[episode(1, 4, 8, "Follow the Anger", null, "ep")], "S04E08 · Follow the Anger", "ep"],
		[[episode(1, 2, 4), episode(2, 2, 5), episode(3, 2, 6)], "3 new episodes · S02E04–06", "show"],
		[[episode(1, 2, 4), episode(2, 2, 7)], "2 new episodes · Season 2", "show"],
		[[episode(1, 1, 9), episode(2, 2, 1)], "2 new episodes · Seasons 1–2", "show"]
	];
	for (const [records, meta, overview] of cases) {
		const helper = stubApi(loadHelper(), { sonarr: () => records });
		const shows = await helper.fetchShows(sonarr, "2026-09-15T00:00:00Z");
		assert.equal(shows.length, 1);
		assert.equal(shows[0].meta, meta);
		assert.equal(shows[0].overview, overview);
	}
});

test("a show's added time is its newest episode", async () => {
	const helper = stubApi(loadHelper(), { sonarr: () => [episode(1, 1, 1, "a", "2026-09-20T10:00:00Z"), episode(2, 1, 2, "b", "2026-09-23T10:00:00Z")] });
	const [show] = await helper.fetchShows(sonarr, "2026-09-15T00:00:00Z");
	assert.equal(show.added, "2026-09-23T10:00:00Z");
});

test("refresh merges, sorts newest first, caps at maxItems and only sends on change", async () => {
	const helper = stubApi(loadHelper(), {
		radarr: () => [{ date: "2026-09-21T10:00:00Z", movie: { id: 1, title: "Older" } }, { date: "2026-09-23T10:00:00Z", movie: { id: 2, title: "Newest" } }],
		sonarr: () => [episode(1, 1, 1, "x", "2026-09-22T10:00:00Z")]
	});
	const sent = [];
	helper.sendSocketNotification = (name, payload) => sent.push(payload);
	helper.prunePosters = () => {};
	const poller = { config: { radarr: radarr, sonarr: sonarr, days: 7, maxItems: 2 }, payload: null };
	helper.pollers = { a: poller };
	helper.refresh("a", poller);
	await new Promise(setImmediate);
	assert.deepEqual(sent[0].items.map((i) => i.title), ["Newest", "Northern Lines"]);
	helper.refresh("a", poller);
	await new Promise(setImmediate);
	assert.equal(sent.length, 1);
});

test("API keys can come from ~/.config/MMM-RecentlyAdded/secrets.json", () => {
	const helper = loadHelper({ radarr: { apiKey: "from-file" }, sonarr: { url: "http://sonarr.local:8989", apiKey: "s-file" } });
	const merged = helper.withSecrets({ radarr: { url: "http://radarr.local:7878" }, days: 7 });
	assert.deepEqual(merged.radarr, { apiKey: "from-file", url: "http://radarr.local:7878" });
	assert.deepEqual(merged.sonarr, { url: "http://sonarr.local:8989", apiKey: "s-file" });
	assert.equal(helper.withSecrets({ radarr: { url: "u", apiKey: "inline" } }).radarr.apiKey, "inline");
});

test("a source without a URL stays off", () => {
	const helper = loadHelper({ radarr: { apiKey: "only-a-key" } });
	assert.equal(helper.withSecrets({}).radarr, null);
	assert.equal(loadHelper().withSecrets({}).radarr, undefined);
});
