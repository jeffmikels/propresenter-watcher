const got = require("got");

class VmixController {
	constructor(url, onupdate = null) {
		this.endpoint = `${url}/api/?`;
		this.lastmessage = "";

		if (onupdate != null) {
			this.onupdate = onupdate;
		} else {
			this.onupdate = () => {};
		}
	}

	send(cmd) {
		let url = `${this.endpoint}${cmd}`;
		console.log(`VMIX: ${url}`);
		this.onupdate("sending command");
		got(url)
			.then(
				(res) => {
					console.log(`VMIX RESPONSE:\n${res.requestUrl}\n${res.body}`);
					this.lastmessage = "command successful";
					this.onupdate(this.lastmessage);
				},
				(err) => {
					// console.log(err);
					this.lastmessage = "command failed";
					this.onupdate(this.lastmessage);
				}
			)
			.catch((err) => {
				console.log("vmix request error");
				this.lastmessage = "error sending command";
				this.onupdate(this.lastmessage);
			});
	}

	// when input is null, we toggle between program and preview
	fadeToInput(input = null, duration = 1000) {
		let cmd = `Function=Fade&Duration=${duration}`;
		if (input != null) cmd += `&Input=${input}`;
		this.send(cmd);
	}

	cutToInput(input = null) {
		let cmd = `Function=Cut`;
		if (input != null) cmd += `&Input=${input}`;
		this.send(cmd);
	}

	fade(duration = 1000) {
		this.fadeToInput(null, duration);
	}

	cut() {
		this.cutToInput(null);
	}

	// selected can be a name or an index
	setInputText(input = null, text = "", selected = "") {
		let cmd = `Function=SetText&Value=${encodeURI(text)}`;
		if (isNaN(+selected)) cmd += `&SelectedName=${selected}`;
		else cmd += "&SelectedIndex=0";
		if (input != null) cmd += `&Input=${input}`;
		this.send(cmd);
	}

	// type can be In, Out, On, Off or nothing for toggle
	// In/Out do a transition, On/Off do a cut
	setOverlay(overlay = 1, type = null, input = null) {
		if (isNaN(+overlay)) overlay = 1;
		let cmd;
		if (type == null) cmd = `Function=OverlayInput${+overlay}`;
		else cmd = `Function=OverlayInput${+overlay}${type}`;
		if (input != null) cmd += `&Input=${input}`;
		this.send(cmd);
	}

	triggerStreaming(onoff = 1, stream = 0) {
		let cmd;
		if (onoff == "off" || onoff == false || onoff == "0" || onoff == 0) cmd = `Function=StopStreaming&Value=${stream}`;
		else cmd = `Function=StartStreaming&Value=${stream}`;
		this.send(cmd);
	}

	api(options) {
		let cmds = [];
		for (let [key, value] of Object.entries(options)) {
			cmds.push(`${key}=${encodeURI(value)}`);
		}
		let cmd = cmds.join("&");
		this.send(cmd);
	}
}

module.exports.VmixController = VmixController;
