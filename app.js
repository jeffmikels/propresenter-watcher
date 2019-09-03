// connects to ProPresenter 6 stage display (a websocket connection)
// listens for slide change events
// reads the notes field
// sends out appropriate updates to live event and/or vmix
"use strict";

/* SLIDE NOTES DOCUMENTATION
LIVE EVENTS:
event[event_id]         ← requests control of an event
live[progress_integer]  ← sends progress to the event as an integer

VMIX:
[novmix] ← if found, no vmix triggers will be processed

vmix[transition_type, [input name/number], [transition duration milliseconds]]
transition_type can be whatever transition vmix supports
second two arguments are optional
input defaults to whatever is set to Preview
transition defaults to 1000 milliseconds

vmixcut[input name/number]               ← shortcut to cut to an input (required)
vmixfade[input name/number, duration]    ← shortcut to fade to an input (duration optional)

vmixtext[input name/number, selected name/index]
puts the current slide body text into the specified text box of the specified input
selected name/index defaults to 0

For advanced vMix control, put vMix API commands in JSON text between vmix tags
[vmix]
{
	"Function": "Slide",
	"Duration": 3000
}
[/vmix]

NOTE: vMix API Documentation is here: https://www.vmix.com/help21/index.htm?DeveloperAPI.html
NOTE: multiple vmix triggers of each type can be handled per slide.

*/

// ----- SETUP HAPPENS HERE ----------------

// configuration
const config = require("./config.js");

// modules
const { Pro6Listener, Pro6Controller } = require("./modules/pro6.js");
const LiveEventController = require("./modules/live-event-controller.js");
const VmixController = require("./modules/vmix-controller.js");

let Log = console.log;
if (config.useweblog) {
	const WebLogger = require("./modules/web-logger.js");
	const weblog = new WebLogger(config.LOGGER_URL, config.LOGGER_KEY);
	Log = function(s, allowWebLog = true) {
		if (allowWebLog) weblog.log(s);
		console.log(s);
	};
}

// LIVE EVENT API HANDLER
let lec = new LiveEventController(config.LCC_LIVE_URL, 0);

// VMIX API HANDLER
let vmix = new VmixController("http://" + config.VMIX_HOST);

// global ProPresenterListener for future use;
let pl;

// (-- THIS IS WHERE THE MAGIC HAPPENS --)
// TRIGGERS
// triggers have the pattern
// {
//	name: 'Description of this trigger.',
// 	type: 'timer|slides|systime',
// 	test: function returning a boolean called with this data object,
// 	callback: function to call if there was a match (argument is the proper data object),
// }
let allow_triggers = true;

// slide note search patterns
const sermon_start_pattern = /\[sermon_start\]/i;
const live_event_pattern = /event\[(\d+)\]/i;
const live_progress_pattern = /live\[(\d+)\]/i;
const vmix_ignore_pattern = /\[novmix\]/i;

// vmix[(transition name),(input name/number optional),(transition duration)]
const vmix_trans_pattern = /vmix\[(\w+)\s*(?:,\s*(.+?))?\s*(?:,\s*(\d+))?\s*\]/gi;
const vmix_fade_pattern = /vmixfade\[(.+?)\s*(?:,\s*(\d+))?\s*\]/gi;
const vmix_cut_pattern = /vmixcut\[(.+?)\s*\]/gi;
// inside the bracket, the arguments should be input name or number, selected name
const vmix_text_pattern = /vmixtext\[(.+?)\s*(?:,\s*(.+?))?\s*\]/gi;
const vmix_advanced = /\[vmix\](.+?)\[\/vmix\]/gis;

const pro6_triggers = [
	{
		name: "Testing Timer Trigger",
		type: "timer",
		enabled: true,
		test: (d) => d.uid == "47E8B48C-0D61-4EFC-9517-BF9FB894C8E2",
		callback: (d) => {
			Log(`COUNTDOWN TIMER TRIGGERED:`);
			Log(d);
		},
	},
	{
		name: "SlideNotes Sermon Start Checker",
		type: "slides",
		enabled: true,
		test: () => true,
		callback: (slides) => {
			let match;

			// check current notes for live event data
			match = slides.current.notes.match(sermon_start_pattern);
			if (match) {
				let now = new Date();
				Log("SERMON STARTING: " + timestamp());
			}
		},
	},
	{
		name: "SlideNotes Live Event Checker",
		type: "slides",
		enabled: true,
		test: () => true,
		callback: (slides) => {
			let match;
			Log("======== SLIDE NOTES ==============");
			Log(slides.current.notes);
			Log("===================================");

			// check current notes for live event data
			match = slides.current.notes.match(live_event_pattern);
			if (match) {
				lec.control(match[1]);
				let logstring = "LIVE EVENT CONTROL: event " + match[1];
				Log(logstring);
			}

			match = slides.current.notes.match(live_progress_pattern);
			if (match) {
				lec.update(match[1]);
				let logstring = `LIVE EVENT UPDATE: event ${lec.eid} progress ${match[1]}`;
				Log(logstring);
			}
		},
	},
	{
		name: "vMix Lyrics Handler",
		type: "slides",
		enabled: true,
		test: () => true,
		callback: (slides) => {
			// handle lyrics always
			vmix.setInputText(config.VMIX_LYRICS_INPUT, slides.current.text);
		},
	},
	{
		name: "vMix Notes Checker",
		type: "slides",
		enabled: true,
		test: () => true,
		callback: (slides) => {
			let match;
			Log("======== SLIDE NOTES ==============");
			Log(slides.current.notes);
			Log("===================================");

			// check current notes for auto vmix data
			match = slides.current.notes.match(vmix_ignore_pattern);
			if (match) {
				Log("[novmix] found... ignoring vmix commands");
				return;
			}

			// vmix triggers are allowed
			// fade trigger
			match = true;
			while (match) {
				match = vmix_fade_pattern.exec(slides.current.notes);
				if (match) {
					Log(`vmix match: ${match[0]}`);
					let duration = 1000;
					if (match[2]) duration = +match[2];
					vmix.fadeToInput(match[1], duration);
				}
			}

			// cut trigger
			match = true;
			while (match) {
				match = vmix_cut_pattern.exec(slides.current.notes);
				if (match) {
					Log(`vmix match: ${match[0]}`);
					vmix.cutToInput(match[1]);
				}
			}

			// generic transition trigger
			match = true;
			while (match) {
				match = vmix_trans_pattern.exec(slides.current.notes);
				if (match) {
					Log(`vmix match: ${match[0]}`);
					let type = match[1].toLowerCase();
					type = type.charAt(0).toUpperCase() + type.slice(1);
					let input = null;
					if (match[2]) input = match[2];
					let duration = 1000;
					if (match[3]) duration = +match[3];
					let options = {
						Function: type,
						Duration: duration,
					};
					if (input) options.Input = input;
					vmix.api(options);
				}
			}

			// text trigger
			match = true;
			while (match) {
				match = vmix_text_pattern.exec(slides.current.notes);
				if (match) {
					Log(`vmix match: ${match[0]}`);
					let selected = 0;
					if (match[2]) selected = match[2];
					vmix.setInputText(match[1], slides.current.text, selected);
				}
			}

			// allow for advanced vmix commands
			match = true;
			while (match) {
				match = vmix_advanced.exec(slides.current.notes);
				if (match && match[1]) {
					Log(`vmix match: ${match[0]}`);
					let options = JSON.parse(match[1]);
					if (options) vmix.api(options);
				}
			}
		},
	},
];

//  ---- UI SERVER CODE ---
const fs = require("fs");
const http = require("http");
const url = require("url");
const WebSocket = require("ws");
const help = `
possible endpoints are the following:
/api/help ← return this text
/api/triggers ← returns a list of current triggers
/api/toggle/trigger_id ← toggles the status of a trigger
/api/toggle ← toggles the status of all trigger processing
`;

const server = http.createServer(httpHandler);

// handles realtime communication with frontend
const wss = new WebSocket.Server({
	server: server,
	clientTracking: true,
});

wss.on("connection", function connection(ws) {
	ws.isAlive = true;

	ws.bettersend = function(message = "", data = {}) {
		ws.send(JSON.stringify({ message, data }));
	};

	ws.on("message", function incoming(raw_message) {
		// to simulate socket.io
		// each "data" will be a JSON encoded dictionary
		// like this:
		// {'message': [string message], 'data': [submitted data]}
		console.log("received: message");
		console.log(raw_message);

		var json = JSON.parse(raw_message);
		var message = json.message;
		var data = json.data;
		vmix.onupdate = (s) => {
			broadcast("vmix", vmix.lastmessage);
		};
		switch (message) {
			case "echo":
				broadcast("echo", data);
				break;
			case "status":
				ws.bettersend("status", getStatus());
				break;
			case "config":
				console.log("updating config");
				for (let key of Object.keys(config)) {
					if (config[key] != data[key]) config[key] = data[key];
				}
				if (pl) {
					pl.host = config.PRO6_HOST;
					pl.password = config.PRO6_SD_PASSWORD;
					if (pl.connected) pl.ws.close();
					pl.connect();
				}
				broadcast("status", getStatus());
				break;
			case "update_triggers":
				console.log("updating triggers");
				for (let i = 0; i < data.length; i++) {
					pro6_triggers[i].enabled = data[i].enabled;
				}
				broadcast("status", getStatus());
				break;
			case "toggle_allow_triggers":
				allow_triggers = data;
				broadcast("status", getStatus());
				break;
		}
	});
});

// send keepalive pings
// const interval = setInterval(function ws_ping() {
// 	wss.clients.forEach(function each(ws) {
// 		if (ws.isAlive === false) return ws.terminate();
// 		ws.isAlive = false;
// 		ws.ping(noop);
// 	});
// }, 30000);

// finally, initialize the ProPresenter Connection
// setup ProPresenter Listener
pl = new Pro6Listener(config.PRO6_HOST, config.PRO6_SD_PASSWORD, {
	onsysupdate: (e) => {
		// console.log(e);
	},
	onslideupdate: (e) => {
		// console.log(e);
	},
	ontimersupdate: (e) => {
		// console.log(e);
	},
	onupdate: (data, pro6) => {
		// console.log("SYSTEM: ");
		// console.log(pro6.system_time);
		// console.log("TIMERS: ");
		// console.log(pro6.timers);
		// console.log("SLIDES: ");
		// console.log(pro6.slides);

		// broadcast("pro6update", data);
		broadcast("status", getStatus());
		// process triggers
		let used = false;
		if (allow_triggers) {
			for (let trigger of pro6_triggers) {
				if (trigger.enabled && trigger.type == data.type && trigger.test(data.data)) {
					console.log(`TRIGGER: ${trigger.name}`);
					trigger.callback(data.data);
					used = true;
				}
			}
			if (!used) {
				console.log("No triggers configured, for this data:");
				console.log(data);
			}
		} else {
			console.log("ProPresenter Update, but triggers are disabled.");
			console.log(data);
		}
	},
});

// and start the ui server
console.log(`Starting ProPresenter Watcher UI Server on port ${config.UI_SERVER_PORT}`);
server.listen(config.UI_SERVER_PORT);

// OTHER FUNCTIONS
function noop() {}
function getStatus() {
	return {
		config,
		allow_triggers,
		triggers: pro6_triggers,
		pro6_status: pl.status(),
		vmix_status: vmix.lastmessage,
	};
}
function broadcast(message, data) {
	wss.clients.forEach(function each(ws) {
		ws.send(JSON.stringify({ message, data }));
	});
}
function triggerStatus() {
	let retval = { allow_triggers, triggers: [] };
	for (let i = 0; i < pro6_triggers.length; i++) {
		let t = pro6_triggers[i];
		let o = {
			name: t.name,
			description: t.description,
			enabled: t.enabled,
			id: i,
		};
		retval.triggers.push(o);
	}
	return retval;
}

function httpHandler(req, res) {
	// console.log(req);
	if (req.url.match(/\/api\//)) {
		let match;
		let output;

		// get help
		match = req.url.match(/\/api\/help\/?$/);
		if (match) {
			res.writeHead(200, { "Content-type": "text/plain;charset=UTF-8" });
			res.end(help);
			return;
		} else {
			res.writeHead(200, { "Content-type": "application/json;charset=UTF-8" });
		}

		// get all triggers
		match = req.url.match(/\/api\/triggers\/?$/);
		if (match) {
			output = JSON.stringify(triggerStatus());
		}

		match = req.url.match(/\/api\/toggle\/?$/);
		if (match) {
			allow_triggers = !allow_triggers;
			output = JSON.stringify(triggerStatus());
		}

		match = req.url.match(/\/api\/toggle\/(\d*)\/?$/);
		if (match) {
			let id = +match[1];
			if (id < pro6_triggers.length && id >= 0) {
				pro6_triggers[id].enabled = !pro6_triggers[id].enabled;
			}
			output = JSON.stringify(triggerStatus());
		}
		res.end(output);
	} else {
		// does the request result in a real file?
		let pathName = url.parse(req.url).pathname;
		if (pathName == "/") pathName = "/index.html";
		console.log(pathName);
		fs.readFile(__dirname + pathName, function(err, data) {
			if (err) {
				res.writeHead(404);
				res.write("Page not found.");
				res.end();
			} else {
				res.writeHead(200, { "Content-type": "text/html;charset=UTF-8" });
				res.write(data);
				res.end();
			}
		});
	}
}

function timestamp() {
	let d = new Date();
	let year = d.getFullYear();
	let month = d
		.getMonth()
		.toString()
		.padStart(2, "0");
	let day = d
		.getDate()
		.toString()
		.padStart(2, "0");
	let hour = d
		.getHours()
		.toString()
		.padStart(2, "0");
	let min = d
		.getMinutes()
		.toString()
		.padStart(2, "0");
	let sec = d
		.getSeconds()
		.toString()
		.padStart(2, "0");
	return `${year}-${month}-${day} ${hour}:${min}:${sec}`;
}
