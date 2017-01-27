const React = require('react');
const ReactDOM = require('react-dom');

// generic input data collection error indicating an issue with upstream value
// upstream errors are handled separately, so this error report is a minimal sentinel object
class InputError extends Error {
    constructor() {
        super('Input error'); // generic text message suitable enough for e.g. a form

        this.name = 'InputError'; // @todo is there a way to do this via super()?
    }
}

const COLLECTABLE_GETTER_KEY = '__collectableGetter_' + Math.round(Math.random() * 10000);

function connect(obj, getter) {
    if (!(obj instanceof React.Component)) {
        throw new Error('expecting React component');
    }

    obj[COLLECTABLE_GETTER_KEY] = getter;
}

function collect(obj) {
    const getter = obj[COLLECTABLE_GETTER_KEY];

    if (!getter) {
        throw new Error('instance not collectable');
    }

    return getter();
}

// @todo write test case for conditional params (key should not even be present in returned map)
class Map extends React.PureComponent {
    constructor() {
        super();

        this._nodeMap = Object.create(null);

        // @todo support dynamic parameter names? can already be dynamic but not collection-time
        const setNode = (name, node) => {
            // detect duplicate parameters (all map keys are normally cleaned up on re-render)
            if (Object.prototype.hasOwnProperty.call(this._nodeMap, name)) {
                throw new Error('duplicate parameter name: ' + name);
            }

            this._nodeMap[name] = node;
        };

        const unsetNode = (name, node) => {
            if (this._nodeMap[name] === node) {
                // stop reporting this node's key altogether
                delete this._nodeMap[name];
            }
        };

        this._parameterComponent = function Parameter(props) {
            const parameterName = props.name;
            var refNode = null;

            return React.cloneElement(
                React.Children.only(props.children),
                { ref: (node) => {
                    if (node) {
                        setNode(parameterName, node);
                    } else {
                        unsetNode(parameterName, refNode);
                    }

                    refNode = node;
                } }
            );
        };

        connect(this, this._collectValue.bind(this));
    }

    _collectValue() {
        // wrap collection itself into promise body to catch and report developer errors
        return new Promise((resolve, reject) => {
            const nameList = Object.keys(this._nodeMap);
            const valuePromiseList = nameList.map((name) => collect(this._nodeMap[name]));

            Promise.all(valuePromiseList).then((valueList) => {
                const result = Object.create(null);

                nameList.forEach((name, i) => {
                    result[name] = valueList[i];
                });

                resolve(result);
            }, () => {
                // report typical parameter value rejection
                reject(new InputError());
            });
        });
    }

    render() {
        return this.props.children(this._parameterComponent, this._collectValue.bind(this));
    }
}

// @todo allow cases with sticky pre-validation - i.e. when pre-validated just use that value immediately
// (may still be best done outside of this component, but need the recipe)
class Value extends React.PureComponent {
    constructor() {
        super();

        this.state = {
            currentCollection: null,
            errorValue: null
        };

        connect(this, this._collectValue.bind(this));
    }

    _collectValue() {
        const filter = this.props.filter;
        const inputValue = this._getInputValue();

        // wrap possible synchronous errors in a promise
        // @todo this generates a console error still, on rejection (even though things work as expected otherwise)
        // @todo treat undefined filter result as simple pass-through
        const result = new Promise((resolve) => {
            resolve(filter ? filter(inputValue) : inputValue);
        });

        // save reference but not clear local error yet
        // @todo reconsider
        this.setState({
            currentCollection: result
        });

        // clear local error on success if we are still the active collection process
        result.then((errorValue) => {
            this.setState((state) => state.currentCollection === result
                ? {
                    currentCollection: null,
                    errorValue: null
                }
                : {})
        });

        // report local error if we are still the active collection process
        result.catch((errorValue) => {
            this.setState((state) => state.currentCollection === result
                ? {
                    currentCollection: null,
                    errorValue: errorValue
                }
                : {})
        });

        return result;
    }

    _getInputValue() {
        // @todo radio, checkbox support, etc
        const INPUT_SELECTOR = 'input, select, textarea';
        const rootDomNode = ReactDOM.findDOMNode(this);

        // match self or child node as input element
        const matcher = (
            Element.prototype.matches ||
            Element.prototype.msMatchesSelector ||
            Element.prototype.webkitMatchesSelector
        );

        const inputNode = matcher.call(rootDomNode, INPUT_SELECTOR)
            ? rootDomNode
            : rootDomNode.querySelector(INPUT_SELECTOR);

        return inputNode.value;
    }

    render() {
        return this.props.children(
            this.state.errorValue,
            this.state.currentCollection !== null,
            this._collectValue.bind(this)
        );
    }
}

module.exports = {
    connect: connect,
    collect: collect,

    Map: Map,
    Value: Value,
    InputError: InputError
};
