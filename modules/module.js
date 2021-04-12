const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");

/// each module needs to support the same basic api:
///    static supports multiple?
///    static name
///    static create(options)                      // creates a new instance of this class from options
///    getInfo()                                   // reports instance id and command documentation
/// each module should report its name and a list of triggers with arguments and documentation
/// short-form commands will look like this:
///    cmd[arg,arg,arg]
/// long-form commands look like this (whitespace around 'data' will be stripped):
///    [cmd]data[/cmd]
/// triggers can also be registered on generic propresenter events
/// by specifying the trigger tagname as ~eventname~
/// events are:
///   update, sdupdate, remoteupdate, sddata, remotedata, msgupdate, slideupdate, sysupdate, timersupdate
class Module extends EventEmitter {
  static supportsMultiple = false;
  static instances = [];

  static name = "module";
  static niceName = "Module";
  static create() {
    console.log("unimplemented");
  }

  // lets us read the static name from an instance
  get moduleName() {
    return this.constructor.name;
  }
  get niceName() {
    return this.constructor.niceName;
  }
  get supportsMultiple() {
    return this.constructor.supportsMultiple;
  }
  get instanceName() {
    return this._instanceName ?? this.id ?? this.uuid;
  }
  triggers = []; // a list of ModuleTriggers
  triggersByTag = {};
  enabled = true;

  constructor(config = {}) {
    super();
    this.config = config;
    this.uuid = uuidv4();
    this._instanceName = config.name; // might be null

    // register custom triggers specified in the config
    if (config.triggers) {
      for (let t of config.triggers) {
        this.registerTrigger(
          new ModuleTrigger(
            t.tagname,
            t.description,
            t.args.map(
              (e) =>
                new ModuleTriggerArg(e.name, e.type, e.description, e.optional)
            ),
            (pro, ...args) => t.callback(this, pro, ...args)
          )
        );
      }
    }
  }

  log(s) {
    this.emit("log", s);
  }

  // ModuleTrigger( tagname, description, args, callback )
  registerTrigger(moduleTrigger) {
    moduleTrigger.parent = this;
    if (this.supportsMultiple) {
      moduleTrigger.args = [
        new ModuleTriggerArg(
          "module_name",
          "string",
          `you must specify "${this.instanceName}" as the module_name`,
          false
        ),
        ...moduleTrigger.args,
      ];
    }
    this.triggers.push(moduleTrigger);
    this.triggersByTag[moduleTrigger.tagname] = moduleTrigger;
  }

  getInfo() {
    return {
      id: this.id,
      uuid: this.uuid,
      enabled: this.enabled,
      moduleName: this.moduleName,
      niceName: this.niceName,
      instanceName: this.instanceName,
      requiresInstance: this.supportsMultiple,
      config: this.config,
      triggers: this.triggers.map((e) => e.doc()),
    };
  }

  // ppInstance is the ProPresenter instance
  // that triggered this trigger
  handleTriggerTag(tagname, args, proInstance) {
    if (tagname in this.triggersByTag && this.triggersByTag[tagname].enabled) {
      let trigger = this.triggersByTag[tagname];
      trigger.fire(args, proInstance);
    }
  }

  // if a module wants to track the propresenter
  // data more directly, it should implement a function
  // to handle propresenter updates, but only if a trigger
  // cannot be configured to do what you need.
  handleProUpdate(updateType, pro) {}
}

class ModuleTrigger {
  constructor(tagname, description, args = [], callback) {
    this.uuid = uuidv4();
    this.enabled = true;
    this.tagname = tagname;
    this.description = description;
    this.args = args;
    this.callback = callback;
    this.allow_long_tag =
      this.args.length == 1 && this.args[0].type.match(/string|json/);
  }

  examples() {
    if (this.tagname.match(/^~.+~$/)) return [];
    let examples = [];
    let exampleArgNames = this.args.map((a) => a.typed_name);
    let exampleArgValues = this.args.map((a) => a.example);
    examples.push(`${this.tagname}[${exampleArgNames.join(",")}]`);
    if (this.args.length > 0)
      examples.push(`${this.tagname}[${exampleArgValues.join(",")}]`);
    if (this.allow_long_tag) {
      examples.push(
        `[${this.tagname}]\nYou can put anything here ( < > 😎 , ' ").\n[/${this.tagname}]`
      );
    }
    return examples;
  }

  doc() {
    let label = `slide code: ${this.tagname}`;
    let m = this.tagname.match(/^~(.+)~$/);
    if (m) {
      label = `every ${m[1]}`;
    }
    return {
      uuid: this.uuid,
      label: label,
      parentModule: this.parent?.moduleName ?? null,
      parentName: this.parent?.niceName ?? null,
      tagname: this.tagname,
      description: this.description,
      extrahelp: this.allow_long_tag
        ? 'This trigger can make use of the "long tag" format (see final example below). Tags in this format allow you to use any characters you want, including whitespace, commas, quotation marks, and even emojis. The outermost whitespace will be stripped away, but interior whitespace will be preserved and passed directly to this controller.'
        : "",
      enabled: this.enabled,
      args: this.args.map((e) => e.doc()),
      allowLongTag: this.allow_long_tag,
      examples: this.examples(),
    };
  }

  fireIfEnabled(incomingArgs, ppInstance) {
    if (!this.enabled) return false;
    if (this.parent && !this.parent.enabled) return false;

    // parse each arg according to the arg type
    let parsed = [];

    for (let i = 0; i < this.args.length; i++) {
      let type = this.args[i].type;
      let val = null;
      if (i < incomingArgs.length) {
        let arg = incomingArgs[i];
        switch (type) {
          case "json":
            val = JSON.parse(arg ?? "{}");
            break;
          case "bool":
            val = arg == 1 || arg == true || arg == "true" || arg == "on";
            break;
          case "number":
            val = parseFloat(arg ?? 0);
            break;
          case "string":
          default:
            val = arg ?? "";
        }
      }
      parsed.push(val);
    }

    if (
      this.parent &&
      this.parent.supportsMultiple &&
      this.parent.instanceName != parsed[0]
    )
      return false;

    if (this.parent && this.parent.supportsMultiple) parsed.splice(0);

    this.callback(ppInstance, ...parsed);
    return true;
  }
}

class ModuleTriggerArg {
  constructor(name = "", type = "number", description = "", optional = false) {
    this.name = name;
    this.type = type;
    this.description = description;
    this.optional = optional == true;
    this.typed_name = `${name}_${type}`;
    this.help = "";
    switch (this.type) {
      case "number":
        this.example = (Math.random() * 100).toFixed(0);
        this.help = "numbers can be integers or decimals, positive or negative";
        break;
      case "json":
        this.example = `'{"key1":"value1", "key2":"value2"}'`;
        this.help =
          "If there are any commas, you must wrap the json string in single quotes( ' ) or backticks ( ` ). Valid json uses double quotes around all keys and all string values.";
        break;
      case "bool":
        this.example = "on";
        this.help = " bool values can be any of true,false,1,0,on,off";
        break;
      case "string":
        this.help =
          "Strings with commas must be surrounded by quotation marks. You may use single quotes ('), double quotes (\"), or backticks (`).";
        this.example = "string without comma";
        break;
      default:
        this.example = name;
    }
  }

  doc() {
    return {
      name: this.name,
      type: this.type,
      description: this.description,
      optional: this.optional,
      help: this.help,
      example: this.example,
    };
  }
}

class GlobalModule extends Module {
  static name = "global";
  static niceName = "Global";
}

module.exports = { Module, ModuleTrigger, ModuleTriggerArg, GlobalModule };

/* PEG DOESN'T WORK PROPERLY
{
	function makeCode(type, tag, args) {return {type, tag, args};}
}


Code
 = CodeStart Expression*

CodeStart
 = PreCode CodeIndicator {return null;}

PreCode
 = (!'---' .)* {return '';}

CodeIndicator
 = Whitespace $"---" Whitespace { return '---'; }

Expression
 = LongCode / ShortCode

LongCode
 = Whitespace '[' stag:Tag ']' content:$(!'[/' .)* '[/' etag:Tag ']' Whitespace {
		 if (stag != etag) throw new Error('tags do not match');
		 return makeCode('long',stag, [content]);
	 }

ShortCode
 = Whitespace tag:Tag '[' args:Args ']' Whitespace {return makeCode('short', tag, args); }

Tag
 = $[a-z]*

Args
 = head:Arg tail:(',' Arg)* {return [head, ...tail.map(e=>e[1])]}

Arg
 = Number
 / String

String
 = Separator '"' text:$[^"]* '"' {return text;}
 / Separator '`' text:$[^`]* '`' {return text;}
 / Separator "'" text:$[^']* "'" {return text;}
 / Separator text:$[^'"`\[\],]* {return text;}

Number
 = Float
 / Integer

Float
 = Separator digits:$(Digit+ '.' Digit+) { return parseFloat(digits); }

Integer
 = Separator digits:Digit+ { return parseInt(digits); }

Digit
 = [0-9]

Separator
 = Whitespace
 / [\[\],]

Whitespace
 = [ \t\n\r]* {return '';}
*/
