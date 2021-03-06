/**
 * A tree representation of the template tokens.
 *
 * @module tree
 */
define(function(require, exports, module) {
  "use strict";

  var isString = /['"]+/;

  // Support.
  require("./support/string/trim");

  /**
   * Represents a Tree.
   *
   * @class
   * @memberOf module:tree
   * @param {array} stack - A stack of tokens to parse.
   */
  function Tree(stack) {
    // Internally use a copy of the stack.
    this.stack = stack.slice();

    // The root tree node.
    this.root = {
      type: "Template",
      nodes: []
    };
  }

  /**
   * Takes in an element from the stack of generated tokens.
   *
   * @memberOf module:tree.Tree
   * @param {object} root - Current token in stack or tree node to process.
   * @param {string} END - Token name to cause an expression to end processing.
   * @return {object} The root element decorated or null to stop.
   */
  Tree.prototype.make = function(root, END) {
    root = root || this.root;

    var result;

    // Pull out the first item in the stack.
    while (this.stack.length) {
      var node = this.stack.shift();
      var prev = root.nodes[root.nodes.length - 1];

      switch (node.name) {
        case "START_RAW": {
          root.nodes.push(this.constructProperty(false));

          break;
        }

        case "START_PROP": {
          root.nodes.push(this.constructProperty(true));

          break;
        }

        case "START_EXPR": {
          if (result = this.constructExpression(root, END)) {
            root.nodes.push(result);
            break;
          }
          // Comments return false.
          else if (result !== false) {
            return null;
          }

          break;
        }

        case "END_EXPR": {
          break;
        }

        default: {
          var prevWhitespace = "";

          // Detect previous whitespace to condense.
          if (prev && prev.type === "Text") {
            root.nodes.pop();
            prevWhitespace = prev.value;
          }

          root.nodes.push({
            type: "Text",
            value: prevWhitespace + node.capture[0]
          });

          break;
        }
      }
    }

    return root;
  };

  /**
   * Build a descriptor to describe an instance of a property.
   *
   * @memberOf module:tree.Tree
   * @param {boolean} encoded - Whether or not to encode this property.
   * @return {object} Either a property descriptor or filter pass.
   */
  Tree.prototype.constructProperty = function(encoded) {
    var propertyDescriptor = {
      type: encoded ? "Property" : "RawProperty",
      value: "",
      filters: []
    };

    // Keep iterating through the stack until END_PROP is found.
    while (this.stack.length) {
      var node = this.stack.shift();

      switch (node.name) {
        case "WHITESPACE": {
          break;
        }

        case "FILTER": {
          return this.constructFilter(propertyDescriptor);
        }

        case "END_RAW":
        case "END_PROP": {
          return propertyDescriptor;
        }

        default: {
          propertyDescriptor.value += node.capture[0].trim();
        }
      }
    }

    throw new Error("Unterminated property.");
  };

  /**
   * Build a descriptor to describe an instance of a partial.
   *
   * @memberOf module:tree.Tree
   * @param {object} root - Current token in stack or tree node to process.
   * @return {object} The root element decorated.
   */
  Tree.prototype.constructPartial = function(root) {
    root.type = "PartialExpression";

    // No node in a partial expression?
    delete root.nodes;

    // Partials have arguments passed.
    root.args = [];

    LOOP:
    while (this.stack.length) {
      var node = this.stack.shift();

      switch (node.name) {
        case "OTHER": {
          if (root.value === undefined) {
            root.value = node.capture[0].trim();
          }
          else {
            root.args.push(node.capture[0].trim());
          }

          break;
        }

        case "WHITESPACE": {
          break;
        }

        case "END_EXPR": {
          break LOOP;
        }

        default: {
          throw new Error("Unexpected " + node.name + " encountered.");
        }
      }
    }

    return root;
  };

  /**
   * Build a descriptor to describe an instance of a filter.
   *
   * @memberOf module:tree.Tree
   * @param {object} root - Current token in stack or tree node to process.
   * @return {object} The root element decorated.
   */
  Tree.prototype.constructFilter = function(root) {
    var current = {
      type: "Filter",
      args: []
    };

    var previous = {};

    LOOP:
    while (this.stack.length) {
      var node = this.stack.shift();

      switch (node.name) {
        case "OTHER": {
          if (current.value === undefined) {
            current.value = node.capture[0].trim();
          }
          else {
            current.args.push(node.capture[0].trim());
          }

          break;
        }

        case "WHITESPACE": {
          break;
        }

        case "END_RAW":
        case "END_PROP": {
          root.filters.push(current);

          break LOOP;
        }

        // Allow nested filters.
        case "FILTER": {
          root.filters.push(current);
          this.constructFilter(root);
          break;
        }

        default: {
          throw new Error("Unexpected " + node.name + " encountered.");
        }
      }

      previous = node;
    }

    return root;
  };

  /**
   * Build a descriptor to describe an instance of a loop.
   *
   * @memberOf module:tree.Tree
   * @param {object} root - Current token in stack or tree node to process.
   * @return {object} The root element decorated.
   */
  Tree.prototype.constructEach = function(root) {
    root.type = "LoopExpression";
    root.conditions = [];

    LOOP:
    while (this.stack.length) {
      var node = this.stack.shift();

      switch (node.name) {
        case "OTHER": {
          root.conditions.push({
            type: "Identifier",
            value: node.capture[0].trim()
          });

          break;
        }

        case "ASSIGN": {
          root.conditions.push({
            type: "Assignment",
            value: node.capture[0].trim()
          });

          break;
        }

        case "END_EXPR": {
          break LOOP;
        }
      }
    }

    this.make(root, "END_EACH");

    return root;
  };

  /**
   * Build a descriptor to describe an instance of a comment.
   *
   * @memberOf module:tree.Tree
   * @param {object} root - Current token in stack or tree node to process.
   * @return {object} The root element decorated.
   */
  Tree.prototype.constructComment = function(root) {
    var previous = {};

    while (this.stack.length) {
      var node = this.stack.shift();

      switch (node.name) {
        case "COMMENT": {
          if (previous.name === "START_EXPR") {
            this.constructComment(root);
            break;
          }

          break;
        }

        case "END_EXPR": {
          if (previous.name === "COMMENT") {
            return false;
          }

          break;
        }
      }

      previous = node;
    }

    return false;
  };

  /**
   * Build a descriptor to describe an instance of a conditional.
   *
   * @memberOf module:tree.Tree
   * @param {object} root - Current token in stack or tree node to process.
   * @param {string} kind - A way to determine else from elsif.
   * @return {object} The root element decorated.
   */
  Tree.prototype.constructConditional = function(root, kind) {
    root.type = root.type || "ConditionalExpression";
    root.conditions = root.conditions || [];

    var previous = {};

    if (kind === "ELSE") {
      root.els = { nodes: [] };
      return this.make(root.els, "END_IF");
    }

    if (kind === "ELSIF") {
      root.elsif = { nodes: [] };
      return this.constructConditional(root.elsif);
    }

    LOOP:
    while (this.stack.length) {
      var node = this.stack.shift();
      var value = node.capture[0].trim();

      switch (node.name) {
        case "NOT": {
          root.conditions.push({
            type: "Not"
          });

          break;
        }

        case "EQUALITY":
        case "NOT_EQUALITY":
        case "GREATER_THAN":
        case "GREATER_THAN_EQUAL":
        case "LESS_THAN":
        case "LESS_THAN_EQUAL": {
          root.conditions.push({
            type: "Equality",
            value: node.capture[0].trim()
          });

          break;
        }

        case "END_EXPR": {
          break LOOP;
        }

        case "WHITESPACE": {
          break;
        }

        default: {
          if (value === "false" || value === "true") {
            root.conditions.push({
              type: "Literal",
              value: value
            });

            break;
          }
          // Easy way to determine if the value is NaN or not.
          else if (Number(value) === Number(value)) {
            root.conditions.push({
              type: "Literal",
              value: value
            });
          }
          else if (isString.test(value)) {
            root.conditions.push({
              type: "Literal",
              value: value
            });

            break;
          }
          else if (previous.type === "Identifier") {
            previous.value += value;
            break;
          }
          else {
            root.conditions.push({
              type: "Identifier",
              value: value
            });
            break;
          }
        }
      }

      // Store the previous condition object if it exists.
      previous = root.conditions[root.conditions.length - 1] || {};
    }

    this.make(root, "END_IF");
    return root;
  };

  /**
   * Build a descriptor to describe an instance of an expression.
   *
   * @memberOf module:tree.Tree
   * @param {object} root - Current token in stack or tree node to process.
   * @param {string} END - Token name to cause an expression to end processing.
   * @return {object} The root element decorated.
   */
  Tree.prototype.constructExpression = function(root, END) {
    var expressionRoot = {
      nodes: []
    };

    // Find the type.
    while (this.stack.length) {
      var type = this.stack.shift();

      switch (type.name) {
        //  WHEN ANY OF THESE ARE HIT, BREAK OUT.
        case END: {
          return;
        }

        case "WHITESPACE": {
          break;
        }

        case "COMMENT": {
          return this.constructComment(expressionRoot);
        }

        case "START_EACH": {
          return this.constructEach(expressionRoot);
        }

        case "ELSIF":
        case "ELSE":
        case "START_IF": {
          if (type.name !== "START_IF") {
            expressionRoot = root;
          }

          return this.constructConditional(expressionRoot, type.name);
        }

        case "PARTIAL": {
          return this.constructPartial(expressionRoot);
        }

        default: {
          throw new Error("Invalid expression type.");
        }
      }
    }
  };

  module.exports = Tree;
});
