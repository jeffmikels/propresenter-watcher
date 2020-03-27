// WS module doesn't work in browsers
const WebSocket = require("ws");

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

class Slide {
	constructor() {
		this.uid = "";
		this.text = "";
		this.notes = "";
	}
}

// listens to ProPresenter
// as a stage display client
class Pro6Listener {
	constructor(host, password, options) {
		this.host = host;
		this.connected = false;
		this.password = password;
		this.active = false;

		this.stage_message = "";
		this.system_time = { text: "", seconds: 0 };
		this.timers = {};
		this.slides = {
			current: new Slide(),
			next: new Slide(),
		};

		this.onupdate = options.onupdate;
		this.onmsgupdate = options.onmsgupdate;
		this.onsysupdate = options.onsysupdate;
		this.onslideupdate = options.onslideupdate;
		this.ontimersupdate = options.ontimersupdate;

		this.connect();
	}

	status() {
		return {
			system_time: this.system_time,
			timers: this.timers,
			stage_message: this.stage_message,
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
		console.log(data);
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
			case "msg":
				// { acn: 'msg', txt: 'Test' }
				this.stage_message = data.txt;
				newdata = { type: "message", data: this.stage_message };
				if (this.onmsgupdate) this.onmsgupdate(this.stage_message);
				break;
			case "fv":
				// we expect 4 items identified by the 'acn' field
				// cs: current slide
				// csn: current slide notes
				// ns: next slide
				// nsn: next slide notes

				this.slides.current = new Slide();
				this.slides.next = new Slide();
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
	constructor(host, password, options) {
		this.connected = false;
		this.controlling = false;
		this.password = password;

		this.ws = new WebSocket(`ws://${host}/remote`);

		this.ws.on("message", (data) => {
			this.handleData(JSON.parse(data));
		});
		this.ws.on("open", () => {
			this.authenticate();
		});
		this.ws.on("close", () => {
			this.connected = false;
			this.controlling = false;
		});

		this.onupdate = options.onupdate;
		this.callbacks = {};

		// handle pro6 status
		this.status = {
			currentPresentation: null,
			currentSlideIndex: 0,
			library: [],
			playlists: [],
		};
	}

	send(Obj, callback = null) {
		// register callback if there is one.
		if (typeof callback == "function") {
			// fix api bug
			let responseAction = Obj.action;
			if (Obj.action == "presentationRequest") responseAction = "presentationCurrent";
			this.callbacks[responseAction] = callback;
		}
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

	flattenPlaylist(playlistObj) {
		let flattened = [];
		switch (playlistObj.playlistType) {
			case "playlistTypePlaylist":
				flattened = playlistObj.playlist;
				break;
			case "playlistTypeGroup":
				for (let playlist of playlistObj.playlist) {
					flattened.push(...this.flattenPlaylist(playlist));
				}
				break;
		}
		return flattened;
	}

	loadStatus() {
		this.getLibrary();
		this.getPlaylists();
		this.getPresentation();
		this.getCurrentSlideIndex();
	}

	handleData(data) {
		console.log(data);

		// process data for this class instance
		switch (data.action) {
			case "authenticate":
				if (data.authenticated == 1) this.connected = true;
				if (data.controller == 1) this.controlling = true;

				if (this.connected) this.loadStatus();
				break;
			case "libraryRequest":
				this.status.library = data.library;
				break;
			case "playlistRequestAll":
				this.status.playlists = this.flattenPlaylist(data.playlistAll);
				break;
			case "presentationCurrent":
				this.status.currentPresentation = data.presentation;
				break;
			case "presentationSlideIndex":
				this.status.currentSlideIndex = +data.slideIndex;
				break;
			case "presentationTriggerIndex":
				this.status.currentSlideIndex = +data.slideIndex;
				if (this.status.currentPresentation == null) {
					this.getPresentation();
				}
		}

		// handle update stream
		if (this.onupdate) this.onupdate(data, this);

		// handle callbacks
		if (typeof this.callbacks[data.action] == "function") {
			this.callbacks[data.action](data);
			delete this.callbacks[data.action];
		}
	}

	getLibrary(callback = null) {
		this.send({ action: "libraryRequest" }, callback);
	}

	getPlaylists(callback = null) {
		this.send({ action: "playlistRequestAll" }, callback);
	}

	getPresentation(path = null, quality = 10, callback = null) {
		if (path == null) {
			this.send(
				{
					action: "presentationCurrent",
					presentationSlideQuality: quality,
				},
				callback
			);
		} else {
			this.send(
				{
					action: "presentationRequest",
					presentationPath: path,
					presentationSlideQuality: quality,
				},
				callback
			);
		}
	}

	getCurrentSlideIndex(callback = null) {
		this.send({ action: "presentationSlideIndex" }, callback);
	}

	triggerSlide(index = 0, path = null, callback = null) {
		if (!this.controlling) return false;
		if (path == null && this.status.currentPresentation == null) return false;
		if (path == null) path = this.status.currentPresentation.presentationCurrentLocation;
		this.send(
			{
				action: "presentationTriggerIndex",
				slideIndex: index,
				presentationPath: path,
			},
			callback
		);
		return true;
	}

	next(callback = null) {
		if (this.status.currentPresentation == null) return false;
		if (this.status.currentSlideIndex == null) return false;
		let nextIndex = this.status.currentSlideIndex + 1;
		return this.triggerSlide(nextIndex, null, callback);
	}

	prev(callback = null) {
		if (this.status.currentPresentation == null) return false;
		if (this.status.currentSlideIndex == null) return false;
		let nextIndex = this.status.currentSlideIndex - 1;
		if (nextIndex < 0) nextIndex = 0;
		return this.triggerSlide(nextIndex, null, callback);
	}
}

module.exports.Pro6Listener = Pro6Listener;
module.exports.Pro6Controller = Pro6Controller;
