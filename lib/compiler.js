/**
 * Compiles a template Tree into JavaScript.
 *
 * @module compiler
 * @requires shared/register_partial
 * @requires shared/register_filter
 * @requires shared/map
 * @requires shared/encode
 * @requires utils/type
 * @requires utils/create_object
 */
define(function(require, exports, module) {
  "use strict";

  // Shared.
  var registerPartial = require("./shared/register_partial");
  var registerFilter = require("./shared/register_filter");
  var map = require("./shared/map");
  var encode = require("./shared/encode");

  // Utils.
  var type = require("./utils/type");
  var createObject = require("./utils/create_object");

  // Support.
  require("./support/array/map");
  require("./support/array/reduce");

  // Borrowed from Underscore.js template function.
  var escaper = /\\|'|\r|\n|\t|\u2028|\u2029/g;

  // Borrowed from Underscore.js template function.
  var escapes = {
    "'": "'",
    "\\": "\\",
    "\r": "r",
    "\n": "n",
    "\t": "t",
    "\u2028": "u2028",
    "\u2029": "u2029"
  };

  /**
   * Escapes passed values.
   *
   * @private
   * @param {string} value - The value to escape.
   * @returns {string} The value escaped.
   */
  function escapeValue(value) {
    return value.replace(escaper, function(match) {
      return "\\" + escapes[match];
    });
  }

  /**
   * Normalizes properties in the identifier to be looked up via hash-style
   * instead of dot-notation.
   *
   * @private
   * @param {string} identifier - The identifier to normalize.
   * @returns {string} The identifier normalized.
   */
  function normalizeIdentifier(identifier) {
    if (identifier === ".") {
      return "data['.']";
    }

    return "data" + identifier.split(".").map(function(property) {
      return "['" + property + "']";
    }).join("");
  }

  /**
   * Represents a Compiler.
   *
   * @class
   * @memberOf module:compiler
   * @param {Tree} tree - A template [Tree]{@link module:tree.Tree} to compile.
   */
  function Compiler(tree) {
    this.tree = tree;
    this.string = "";

    var compiledSource = this.process(this.tree.nodes);

    // The compiled function body.
    var body = [];

    // If there is a function, concatenate it to the default empty value.
    if (compiledSource) {
      compiledSource = " + " + compiledSource;
    }

    // Include map and its dependencies.
    if (compiledSource.indexOf("map(") > -1) {
      body.push(createObject, type, map);
    }

    // Include encode and its dependencies.
    if (compiledSource.indexOf("encode(") > -1) {
      body.push(type, encode);
    }

    // The compiled function body.
    body = body.concat([
      // Return the evaluated contents.
      "return ''" + compiledSource
    ]).join(";\n");

    // Create the JavaScript function from the source code.
    this.func = new Function("data", "partials", "filters", body);

    // toString the function to get its raw source and expose.
    this.source = [
      "{",
        "_partials: {},",
        "_filters: {},",
        "registerPartial: " + registerPartial + ",",
        "registerFilter: " + registerFilter + ",",
        "render: function(data) {",
          "return " + this.func + "(data, this._partials, this._filters)",
        "}",
      "}"
    ].join("\n");
  }

  /**
   * A recursively called method to detect how to compile each Node in the
   * Tree.
   *
   * @memberOf module:compiler.Compiler
   * @param {array} nodes - An Array of Tree nodes to process.
   * @return {string} Joined compiled nodes representing the template body.
   */
  Compiler.prototype.process = function(nodes) {
    var commands = [];

    // Parse the Tree and execute the respective compile to JavaScript method.
    nodes.map(function(node) {
      switch (node.type) {
        case "RawProperty": {
          commands.push(this.compileProperty(node, false));
          break;
        }

        case "Property": {
          commands.push(this.compileProperty(node, true));
          break;
        }

        case "ConditionalExpression": {
          commands.push(this.compileConditional(node));
          break;
        }

        case "LoopExpression": {
          commands.push(this.compileLoop(node));
          break;
        }

        case "PartialExpression": {
          commands.push(this.compilePartial(node));
          break;
        }

        default: {
          commands.push("'" + escapeValue(node.value) + "'");
        }
      }
    }, this);

    return commands.join("+");
  };

  /**
   * Compiles a property into JavaScript.
   *
   * @memberOf module:compiler.Compiler
   * @param {object} node - The property node to compile.
   * @return {string} The compiled JavaScript source string value.
   */
  Compiler.prototype.compileProperty = function(node, encode) {
    var identifier = node.value;

    // Normalize string property values that contain single or double quotes.
    if (identifier.indexOf("'") === -1 && identifier.indexOf("\"") === -1) {
      identifier = normalizeIdentifier(node.value);
    }

    // Build the initial identifier value check.
    var value = [
      "(",
        // If the identifier is a function, then invoke, otherwise return
        // identifier.
        "typeof", identifier, "===", "'function'",
          "?", encode ? "encode(" + identifier + "())" : identifier + "()",
          ":", encode ? "encode(" + identifier + ")" : identifier,
      ")"
    ].join(" ");

    // Find any filters and nest them.
    value = node.filters.reduce(function(memo, filter) {
      var args = filter.args.length ? ", " + filter.args.join(", ") : "";
      return "filters['" + filter.value + "']" + "(" + memo + args + ")";
    }, value);

    return value;
  };

  /**
   * Compiles a conditional into JavaScript.
   *
   * @memberOf module:compiler.Compiler
   * @param {object} node - The conditional node to compile.
   * @return {string} The compiled JavaScript source string value.
   */
  Compiler.prototype.compileConditional = function(node) {
    if (node.conditions.length === 0) {
      throw new Error("Missing conditions to if statement.");
    }

    var condition = node.conditions.map(function(condition) {
      switch (condition.type) {
        case "Identifier": {
          return normalizeIdentifier(condition.value);
        }

        case "Not": {
          return "!";
        }

        case "Literal": {
          return condition.value;
        }

        case "Equality": {
          return condition.value;
        }
      }
    }).join(" ");

    // If an else was provided, hook into it.
    var els = node.els ? this.process(node.els.nodes) : null;

    // If an elsif was provided, hook into it.
    var elsif = node.elsif ? this.compileConditional(node.elsif) : null;

    return [
      "(", "(", condition, ")", "?", this.process(node.nodes), ":",

      els || elsif || "''",

      ")"
    ].join("");
  };

  /**
   * Compiles a loop into JavaScript.
   *
   * @memberOf module:compiler.Compiler
   * @param {object} node - The loop node to compile.
   * @return {string} The compiled JavaScript source string value.
   */
  Compiler.prototype.compileLoop = function(node) {
    var conditions = node.conditions || [];

    var keyVal = [
      // Key
      (conditions[3] ? conditions[3].value : "i"),

      // Value.
      (conditions[2] ? conditions[2].value : ".")
    ];

    // Normalize the value to the condition if it exists.
    var value = conditions.length && conditions[0].value;

    // Construct the loop, utilizing map because it will return back the
    // template as an array and ready to join into the template.
    var loop = [
      "map(", value ? normalizeIdentifier(value) : "data", ",",

        // Index keyword.
        "'", keyVal[0], "'", ",",

        // Value keyword.
        "'", value ? keyVal[1] : "", "'", ",",

        // Outer scope data object.
        "data", ",",

        // The iterator function.
        "function(data) {",
          "return " + this.process(node.nodes, keyVal),
        "}",
      ").join('')"
    ].join("");

    return loop;
  };

  /**
   * Compiles a partial into JavaScript.
   *
   * @memberOf module:compiler.Compiler
   * @param {object} node - The partial node to compile.
   * @return {string} The compiled JavaScript source string value.
   */
  Compiler.prototype.compilePartial = function(node) {
    return [
      "(",
        "partials['" + node.value + "'].render(",
          node.args.length ? normalizeIdentifier(node.args[0]) : "null",
        ")",
      ")"
    ].join("");
  };

  module.exports = Compiler;
});
