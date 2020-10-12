const main = "app.js";

var process = require("process");
var cp = require("child_process");
var fs = require("fs");

var server = cp.fork(main);
console.log("Server started");

fs.watchFile(main, function(event, filename) {
	console.log(`${main} file changed on disk... reloading`);
	server.kill();
	console.log("Server stopped");
	server = cp.fork(main);
	console.log("Server started");
});

process.on("SIGINT", function() {
	server.kill();
	fs.unwatchFile(main);
	process.exit();
});
