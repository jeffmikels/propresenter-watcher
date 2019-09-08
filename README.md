This node application listens to ProPresenter's Stage Display and/or Control interfaces
and will trigger javascript actions based upon updates from them.

These modules are included:

-   ProPresenter -- for listening to and controlling ProPresenter
-   vMix -- for sending vMix API messages
-   LCC Live Event Controller -- for controlling the LCC Live Event System
-   Web Logger -- for sending log strings to a webserver with apikey authentication
-   MIDI -- for sending midi notes, program changes, control changes, and timecodes

Any npm package can be installed and used.
The recommended way to add new functionality is to include the package with

`npm install --save package-name`

and then to write a wrapper class in the modules directory.

Import the class and create an instance of the class in the main app.js file so that the triggers can fire appropriately.

Important documentation is contained in the app.js file.

## Installation

```
git clone https://github.com/jeffmikels/propresenter-watcher.git
cd propresenter-watcher
npm install
```

During installation, a number of node modules will be downloaded.

However, the MIDI component of this system relies on the `node-midi` module which requires compiling `rtmidi`, and therefore, a compiler must be installed.

The easiest way to do that is to follow the `node-gyp` instructions for your operating system here [https://github.com/nodejs/node-gyp].

If you ever need to rebuild the midi module, you can use this command:

```
npm rebuild
```

For more information, visit the node-midi documentation here [https://github.com/justinlatimer/node-midi]

## Configuration

After installation is complete copy `config.js.example` to `config.js` and edit the file according to your system's needs.

Note: ProPresenter will only open one network port, and the main network port takes precedence. In other words, save yourself some hassle and put the same port number in both fields of the ProPresenter Network configuration.

## Setting Up Triggers

Read the comments in the `app.js` file so you can understand the way the slide notes should be created in ProPresenter. Then, take a look at how the example triggers are configured and feel free to change them for your needs.

## Using Live

### Run the app

To run the app, open up a terminal / command window in the folder where this code is stored.

```
node app.js
```

### Open the UI

Then, open a browser to `http://localhost:7000` (or whatever port you specified in the config.js file).

### Use the vmix lower3 webpage

If you are integrating with vmix, obs, or some other system, you can open a specially designed "lower third" webpage that will be updated whenever ProPresenter text changes.

`http://localhost:7000/lower3.html`
