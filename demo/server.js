"use strict";
// Preview of the real module front end with made-up titles and generated covers.
// No Radarr, Sonarr or MagicMirror needed: `npm run demo`, then open http://localhost:3300.
const http = require("http");
const fs = require("fs");
const path = require("path");

const HOUR = 60 * 60 * 1000;

// Fictional titles: the screenshots must not show anyone's real library or studio artwork.
const ITEMS = [
	{ title: "The Quiet Harbour", meta: "2025 · 1h 52m · ★ 7.8", hoursAgo: 2, colors: ["#1d3b53", "#0b1320", "#f2c14e"], motif: "sun",
		overview: "A retired lighthouse keeper returns to the island she left forty years ago and finds the light still burning." },
	{ title: "Northern Lines", meta: "3 new episodes · S02E04–06", hoursAgo: 20, colors: ["#2b4a3f", "#0c1612", "#9fd8c3"], motif: "rails",
		overview: "A railway engineer and a cartographer survey the last unmapped line through the Arctic winter." },
	{ title: "Glass Orchard", meta: "2024 · 2h 07m · ★ 8.1", hoursAgo: 30, colors: ["#5a2a3c", "#170b10", "#f4a3b5"], motif: "rings",
		overview: "Three sisters inherit a greenhouse that only blooms at night, and a debt nobody mentioned." },
	{ title: "Tidewater", meta: "S01E08 · The Long Ebb", hoursAgo: 54, colors: ["#23395b", "#08101c", "#7fb4d9"], motif: "waves",
		overview: "The harbour town learns what the storm left behind when the water finally goes out." },
	{ title: "Paper Moons Over the Cartographer's Quiet Kingdom", meta: "2023 · 1h 41m · ★ 7.2", hoursAgo: 75, colors: ["#4b3a1e", "#140f07", "#e8c07a"], motif: "moons",
		overview: "A mapmaker invents a country to win a bet, and then people start moving there." },
	{ title: "Signal & Static", meta: "2 new episodes · Season 3", hoursAgo: 100, colors: ["#302b4f", "#0d0b17", "#b8a9f5"], motif: "bars",
		overview: "A late-night radio host keeps receiving calls from listeners who haven't been born yet." }
];

function payload() {
	return ITEMS.map((item, i) => ({
		key: "demo-" + i,
		title: item.title,
		meta: item.meta,
		overview: item.overview,
		added: new Date(Date.now() - item.hoursAgo * HOUR).toISOString(),
		poster: "MMM-RecentlyAdded/poster/demo/" + i
	}));
}

function escape(text) {
	return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

// Wrap a title onto at most four lines of roughly `width` characters.
function lines(title, width) {
	const out = [];
	title.split(" ").forEach((word) => {
		const last = out[out.length - 1];
		if (last && (last + " " + word).length <= width) out[out.length - 1] = last + " " + word;
		else out.push(word);
	});
	return out.slice(0, 4);
}

function motif(kind, accent) {
	switch (kind) {
		case "sun": return `<circle cx="125" cy="150" r="58" fill="${accent}" opacity=".9"/><rect x="0" y="175" width="250" height="200" fill="#000" opacity=".45"/>` +
			[0, 1, 2, 3].map((i) => `<rect x="${60 + i * 8}" y="${190 + i * 14}" width="${130 - i * 16}" height="3" fill="${accent}" opacity="${0.5 - i * 0.1}"/>`).join("");
		case "rails": return [0, 1, 2, 3, 4, 5].map((i) => `<line x1="${125 - 10 - i * 4}" y1="${90 + i * 30}" x2="${125 + 10 + i * 4}" y2="${90 + i * 30}" stroke="${accent}" stroke-width="3" opacity=".7"/>`).join("") +
			`<line x1="115" y1="80" x2="60" y2="260" stroke="${accent}" stroke-width="2"/><line x1="135" y1="80" x2="190" y2="260" stroke="${accent}" stroke-width="2"/>`;
		case "rings": return [70, 52, 34, 16].map((r, i) => `<circle cx="125" cy="150" r="${r}" fill="none" stroke="${accent}" stroke-width="2" opacity="${0.35 + i * 0.2}"/>`).join("");
		case "waves": return [0, 1, 2, 3, 4].map((i) => `<path d="M0 ${130 + i * 24} Q 62 ${112 + i * 24} 125 ${130 + i * 24} T 250 ${130 + i * 24}" fill="none" stroke="${accent}" stroke-width="2.5" opacity="${0.9 - i * 0.15}"/>`).join("");
		case "moons": return [0, 1, 2, 3, 4].map((i) => `<circle cx="${45 + i * 40}" cy="${150 - Math.sin(i / 4 * Math.PI) * 40}" r="15" fill="${accent}" opacity="${0.4 + i * 0.12}"/><circle cx="${45 + i * 40 + 6 - i * 3}" cy="${150 - Math.sin(i / 4 * Math.PI) * 40}" r="14" fill="#140f07"/>`).join("");
		default: return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x="${38 + i * 22}" y="${210 - (i % 3 + 1) * 34 - i * 4}" width="12" height="${(i % 3 + 1) * 34 + i * 4}" fill="${accent}" opacity="${0.45 + (i % 3) * 0.2}"/>`).join("");
	}
}

function poster(index) {
	const item = ITEMS[index];
	const [top, bottom, accent] = item.colors;
	const text = lines(item.title.toUpperCase(), 16);
	const step = text.length > 3 ? 22 : 26;
	const y0 = 330 - (text.length - 1) * step;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 375" width="250" height="375">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>
<rect width="250" height="375" fill="url(#g)"/>${motif(item.motif, accent)}
${text.map((line, i) => `<text x="125" y="${y0 + i * step}" text-anchor="middle" font-family="Oswald, 'Roboto Condensed', Arial Narrow, sans-serif" font-weight="700" font-size="${text.length > 3 ? 18 : text.length > 1 ? 21 : 26}" letter-spacing="1.5" fill="#f5f1e8">${escape(line)}</text>`).join("")}
<text x="125" y="32" text-anchor="middle" font-family="'Roboto Condensed', Arial Narrow, sans-serif" font-size="11" letter-spacing="3" fill="#f5f1e8" opacity=".7">A DEMO PICTURE</text>
</svg>`;
}

const FILES = {
	"/": ["demo/index.html", "text/html"],
	"/demo.js": ["demo/demo.js", "text/javascript"],
	"/MMM-RecentlyAdded.js": ["MMM-RecentlyAdded.js", "text/javascript"],
	"/MMM-RecentlyAdded.css": ["MMM-RecentlyAdded.css", "text/css"]
};

http.createServer((req, res) => {
	const url = new URL(req.url, "http://localhost");
	const cover = /^\/MMM-RecentlyAdded\/poster\/demo\/(\d+)$/.exec(url.pathname);
	if (cover && ITEMS[+cover[1]]) {
		res.setHeader("Content-Type", "image/svg+xml");
		return res.end(poster(+cover[1]));
	}
	if (url.pathname === "/data") {
		res.setHeader("Content-Type", "application/json");
		return res.end(JSON.stringify(payload()));
	}
	const file = FILES[url.pathname];
	if (!file) {
		res.statusCode = 404;
		return res.end("Not found");
	}
	res.setHeader("Content-Type", file[1]);
	res.setHeader("Cache-Control", "no-store");
	res.end(fs.readFileSync(path.join(__dirname, "..", file[0])));
}).listen(Number(process.env.PORT || 3300), "127.0.0.1", () => {
	console.log("MMM-RecentlyAdded demo: http://localhost:" + (process.env.PORT || 3300));
});
