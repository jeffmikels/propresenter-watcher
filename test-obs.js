const { default: OBSWebSocket } = require('obs-websocket-js');

const print = console.log;

function findall(regex, subject) {
  let matches = [];
  let match = true;
  while (match) {
    match = regex.exec(subject);
    if (match) {
      matches.push(match);
    }
  }
  return matches;
}

print('------ OBS TESTING -----');
async function testOBS() {
  const obs = new OBSWebSocket();
  try {
    await obs.connect('ws://127.0.0.1:4455', '7bZmcvMKmkOPnLZe');
  } catch (e) {
    console.log(e);
  }
  // print(obs.getStatus());
  // print(await obs.setSceneItemRender('Pro Slide Text', true, 'Live With Lyrics (Text)'));
  // print(await obs.setPreviewScene('Live With Lower Third'));
}

async function main() {
  // obs.on('connected', () => testOBS());
  await testOBS();
}

main();
