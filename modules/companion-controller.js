const net = require("net");

class CompanionController {
	constructor(host, onupdate = null) {
		var data = host.split(":");
		this.host_ip = data[0];
		this.host_port = +data[1];

		this.lastcommand = "";
		this.lastmessage = "";

		if (onupdate != null) {
			this.onupdate = onupdate;
		} else {
			this.onupdate = () => {};
		}
	}

	msg(message) {
		this.lastmessage = message;
		this.onupdate(message);
	}

	send(cmd) {
		this.lastcommand = cmd;
		console.log(`COMPANION: ${this.host_ip}:${this.host_port} ${cmd}`);
		this.msg("connecting to companion");

		let client = new net.Socket();
		client.command = cmd; // save command to the client for later
		client.on("data", (data) => {
			let res = data.toString();
			console.log(`COMPANION RESPONSE: (${client.command}) -> ${res}`);
			if (res.match(/\+OK/)) this.msg("command successful");
			else this.msg("command failed");
		});
		client.connect(this.host_port, this.host_ip, () => {
			console.log(`COMPANION SENDING: ${cmd}`);
			this.msg("sending companion command");
			client.write(cmd + "\x0a");
			client.end();
		});
	}

	pageSelect(page = null, surface = null) {
		if (page == null || surface == null) {
			console.log("page select requires a page number and a surface id");
			this.msg("error sending command");
			return;
		} else {
			let cmd = `PAGE-SET ${page} ${surface}`;
			this.send(cmd);
		}
	}

	buttonPress(page = null, button = null) {
		if (page == null || button == null) {
			console.log("button press requires a page and a button/bank number");
			this.msg("error sending command");
			return;
		} else {
			let cmd = `BANK-PRESS ${page} ${button}`;
			this.send(cmd);
		}
	}
}

module.exports.CompanionController = CompanionController;
