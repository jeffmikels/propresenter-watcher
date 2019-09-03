const io = require("socket.io-client");

// controls the LCC live event server
// using socket.io protocol
class LiveEventController {
	constructor(url, eid) {
		this.connected = false;
		this.controlling = false;
		this.eid = eid;
		this.future_progress = null;

		console.log("LCC LIVE: connecting to " + url);
		this.socket = io(url);

		this.socket.on("connect", () => {
			console.log("LCC LIVE: connected");
			this.connected = true;
			if (this.eid) this.control(this.eid);
		});

		this.socket.on("disconnect", () => {
			console.log("LCC LIVE: disconnected");
			this.connected = false;
			this.controlling = false;
			this.eid = null;
		});

		this.socket.on("control ready", (data) => {
			// console.log(data);
			console.log("LCC LIVE: control confirmed for #" + this.eid);
			this.controlling = this.eid;
			if (this.future_progress != null) {
				this.update(this.future_progress);
				this.future_progress = null;
			}
		});

		this.socket.on("update progress", (progress) => {
			console.log(`PROGRESS CONFIRMED: ${progress}`);
		});
	}

	update(progress) {
		if (this.controlling) {
			console.log("sending live progress: " + progress);
			this.socket.emit("control", progress);
		} else {
			this.future_progress = progress;
		}
	}

	control(eid) {
		if (this.controlling == eid) return;

		this.eid = eid;
		if (this.connected) {
			console.log("sending control request: " + eid);
			this.socket.emit("control request", eid);
		}
	}
}

module.exports = LiveEventController;
