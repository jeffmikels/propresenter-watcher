const { OBSController } = require('./modules/obs-controller');

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
  let obs = new OBSController({ host: '127.0.0.1', port: 4455, password: '7bZmcvMKmkOPnLZe' });
  await obs.future;
  await obs.fade();
  // await obs.getOBSStatus();
  // print(obs.getStatus());
  // print(await obs.setSceneItemRender('Pro Slide Text', true, 'Live With Lyrics (Text)'));
  // print(await obs.setPreviewScene('Live With Lower Third'));
}

async function main() {
  // obs.on('connected', () => testOBS());
  await testOBS();
}

main();
