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
