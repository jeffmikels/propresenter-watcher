// WS module doesn't work in browsers
const WebSocket = require("isomorphic-ws");

const PRO6_SD_PROTOCOL = 610;
const PRO6_CONTROL_PROTOCOL = 600;

function hms2secs(hms) {
	var a = hms.split(":"); // split it at the colons
	// the '+' prefix coerces the string to a number
	var seconds = +a[0] * 60 * 60 + +a[1] * 60 + +a[2];
	if (isNaN(seconds)) seconds = 0;
	return seconds;
}
function timestring2secs(timestring) {
	var match = timestring.match(/\s*(\d+:\d+)\s*([AP]M)/);
	if (!match) return 0;
	let a = match[1].split(":");
	// the '+' prefix coerces the string to a number
	var seconds = +a[0] * 60 * 60 + +a[1] * 60;
	if (isNaN(seconds)) seconds = 0;
	if (match[2] == "PM") seconds += 12 * 60 * 60;
	return seconds;
}

// listens to ProPresenter
// as a stage display client
class Pro6Listener {
	constructor(host, password, options) {
		this.host = host;
		this.connected = false;
		this.password = password;
		this.active = false;

		this.system_time = "";
		this.timers = {};
		this.slides = {
			current: {
				text: "",
				notes: "",
			},
			next: {
				text: "",
				notes: "",
			},
		};

		this.onupdate = options.onupdate;
		this.onsysupdate = options.onsysupdate;
		this.onslideupdate = options.onslideupdate;
		this.ontimersupdate = options.ontimersupdate;

		this.connect();
	}

	status() {
		return {
			system_time: this.system_time,
			timers: this.timers,
			slides: this.slides,
			connected: this.connected,
			active: this.active,
		};
	}

	reconnect(delay = 0) {
		console.log(`Attempting reconnect in ${delay} seconds.`);
		clearTimeout(this.reconnectTimeout);
		this.reconnectTimeout = setTimeout(() => {
			this.connect();
		}, delay * 1000);
	}

	connect() {
		this.connected = false;
		this.active = false;

		clearTimeout(this.reconnectTimeout);

		if (this.ws) this.ws.terminate();
		this.ws = new WebSocket(`ws://${this.host}/stagedisplay`);

		this.ws.on("error", (err) => {
			console.log("ProPresenter WebSocket Error:");
			// console.log(err);
			this.ws.terminate();
			this.reconnect(30);
		});

		this.ws.on("message", (data) => {
			this.check(JSON.parse(data));
		});

		this.ws.on("open", () => {
			this.connected = true;
			this.authenticate();
		});

		this.ws.on("close", () => {
			// this.ws.terminate();
			this.reconnect(10);
			this.connected = false;
			this.active = false;
		});
	}

	send(Obj) {
		this.ws.send(JSON.stringify(Obj));
	}

	authenticate() {
		let PRO6_SD_AUTH = {
			pwd: this.password,
			ptl: PRO6_SD_PROTOCOL,
			acn: "ath",
		};
		this.send(PRO6_SD_AUTH);
	}

	check(data) {
		// console.log(data);
		let newdata = {};
		switch (data.acn) {
			case "ath":
				//{"acn":"ath","ath":true/false,"err":""}
				if (data.ath) {
					console.log("ProPresenter Listener is Connected");
					this.active = true;
					newdata = { type: "authentication", data: true };
				} else {
					this.connected = false;
					this.active = false;
					newdata = { type: "authentication", data: false };
				}
				break;
			case "tmr":
				this.timers[data.uid] = { uid: data.uid, text: data.txt, seconds: hms2secs(data.txt) };
				newdata = { type: "timer", data: this.timers[data.uid] };
				if (this.ontimersupdate) this.ontimersupdate(this.timers[data.uid]);
				break;
			case "sys":
				// { "acn": "sys", "txt": " 11:17 AM" }
				this.system_time = { text: data.txt, seconds: timestring2secs(data.txt) };
				newdata = { type: "systime", data: this.system_time };
				if (this.onsysupdate) this.onsysupdate(this.system_time);
				break;
			case "fv":
				// we expect 4 items identified by the 'acn' field
				// cs: current slide
				// csn: current slide notes
				// ns: next slide
				// nsn: next slide notes

				this.slides.current = {};
				this.slides.next = {};
				for (let blob of data.ary) {
					switch (blob.acn) {
						case "cs":
							this.slides.current.uid = blob.uid;
							this.slides.current.text = blob.txt;
							break;
						case "csn":
							this.slides.current.notes = blob.txt;
							break;
						case "ns":
							this.slides.next.uid = blob.uid;
							this.slides.next.text = blob.txt;
							break;
						case "nsn":
							this.slides.next.notes = blob.txt;
							break;
					}
				}
				newdata = { type: "slides", data: this.slides };
				if (this.onslideupdate) this.onslideupdate(this.slides);
		}
		if (this.onupdate) this.onupdate(newdata, this);
	}
}

// incomplete at the moment
class Pro6Controller {
	constructor(host, port, password, options) {
		this.connected = false;
		this.controlling = false;
		this.password = password;

		this.ws = new WebSocket(`ws://${host}:${port}/remote`);

		this.ws.on("message", (data) => {
			this.handleData(JSON.parse(data));
		});
		this.ws.on("open", () => {
			this.authenticate();
		});

		this.onupdate = options.onupdate;
		this.currentPresentationPath = null;
	}

	send(Obj) {
		this.ws.send(JSON.stringify(Obj));
	}

	authenticate() {
		let PRO6_REMOTE_AUTH = {
			password: this.password,
			protocol: PRO6_CONTROL_PROTOCOL,
			action: "authenticate",
		};
		this.send(PRO6_REMOTE_AUTH);
	}

	handleData(data) {
		console.log(data);
		let newdata = {};
		if (this.onupdate) this.onupdate(newdata, this);
	}

	getLibrary() {
		this.send({ action: "libraryRequest" });
	}

	getPlaylists() {
		this.send({ action: "playlistRequestAll" });
	}

	getPresentation(path = null, quality = 10) {
		if (path == null) {
			this.send({
				action: "presentationCurrent",
				presentationSlideQuality: quality,
			});
		} else {
			this.send({
				action: "presentationRequest",
				presentationPath: path,
				presentationSlideQuality: quality,
			});
		}
	}

	getCurrentSlideIndex() {
		this.send({ action: "presentationSlideIndex" });
	}

	triggerSlide(index = 0, path = null) {
		if (path != null) this.currentPresentationPath = path;
		if (this.currentPresentationPath == null) return false;
		this.send({
			action: "presentationTriggerIndex",
			slideIndex: index,
			presentationPath: this.currentPresentationPath,
		});
	}
}

module.exports.Pro6Listener = Pro6Listener;
