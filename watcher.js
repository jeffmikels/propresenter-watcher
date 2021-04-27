const main = 'app.js';

var process = require('process');
var cp = require('child_process');
var fs = require('fs');

var server = cp.fork(main);
console.log('Server started');

fs.watch('.', { recursive: true }, function (event, filename) {
  console.log(`${filename} file changed on disk...`);
  if (filename.match(/\/ui\//)) {
    console.log('ui code... ignoring');
    return;
  }
  if (!filename.match(/\.js$/)) {
    console.log('not a javascript file... ignoring');
    return;
  }

  console.log(`reloading ${main}`);
  server.kill();
  console.log('Server stopped');
  server = cp.fork(main);
  console.log('Server started');
});

process.on('SIGINT', function () {
  server.kill();
  fs.unwatchFile(main);
  process.exit();
});
