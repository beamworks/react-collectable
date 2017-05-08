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
    // if (!(obj instanceof React.Component)) {
    //     throw new Error('expecting React component');
    // }

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

// pass a marked descendant's value to the parent
class Pass extends React.PureComponent {
    constructor(props) {
        super();

        this._passNode = null;
        this._passComponent = (props) => {
            // save reference to the child wrapped by this pass marker component
            return React.cloneElement(React.Children.only(props.children), {
                ref: (node) => { this._passNode = node; }
            });
        };

        Collectable.connect(this, () => Collectable.collect(this._passNode));
    }

    render() {
        return this.props.children(this._passComponent);
    }
}

// intercept collectable promises and track latest status
// @todo integrate into core lib and remove tracking func from Collectable.Value
class Status extends React.PureComponent {
    constructor(props) {
        super();

        this._inputNode = null;

        this.state = {
            currentCollection: null,
            inputError: null
        }

        Collectable.connect(this, () => {
            const collection = Collectable.collect(this._inputNode);

            this._onPending(collection);

            collection.then(() => {
                this._onCompletion(collection, null);
            }, (error) => {
                this._onCompletion(collection, error);
            });

            return collection;
        });
    }

    _onPending(collection) {
        // track new collection promise but not clear old error yet
        // (some consumers might still need to show it)
        this.setState({
            currentCollection: collection
        });
    }

    _onCompletion(collection, error) {
        // clear pending state only if this is still the current collection promise
        this.setState((state) => state.currentCollection === collection ? {
            currentCollection: null,
            inputError: error
        } : null);
    }

    render() {
        const isPending = this.state.currentCollection !== null;
        const inputError = this.state.inputError;

        return React.cloneElement(this.props.children(inputError, isPending), {
            ref: (node) => { this._inputNode = node; }
        });
    }
}

// @todo allow cases with sticky pre-validation - i.e. when pre-validated just use that value immediately
// @todo remove status tracking here now that the Status component is separately available
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

class Debouncer extends React.PureComponent {
    constructor(props) {
        if (props.delayMs === undefined) {
            throw new Error('must define debounce delay');
        }

        super();

        this._node = null;

        this.state = { currentTimeoutId: null };

        connect(this, this._collectValue.bind(this));
    }

    _collectValue() {
        return new Promise((resolve) => {
            const timeoutId = setTimeout(() => {
                if (this.state.currentTimeoutId !== timeoutId) {
                    return;
                }

                this.setState({ currentTimeoutId: null });

                resolve();
            }, this.props.delayMs);

            this.setState({ currentTimeoutId: timeoutId });
        }).then(() => {
            // collect from child in a "then" handler instead of raw timeout callback
            // to properly wrap synchronous logic
            return collect(this._node);
        });
    }

    render() {
        return React.cloneElement(this.props.children(this.state.currentTimeoutId !== null), {
            ref: (node) => {
                this._node = node;
            }
        })
    }
}

class Prevalidator extends React.PureComponent {
    constructor() {
        super();

        this._node = null;

        this._currentValueBase = null;
        this._currentValue = Promise.reject();

        this.state = { isValid: false };

        connect(this, this._collectValue.bind(this));
    }

    _collectValue() {
        if (this._currentValue === null) {
            throw new Error('value not ready');
        }

        // @todo always get latest value since it is already cached: to catch obscure corner cases where onChange does not fire
        return this._currentValue;
    }

    _update(valueBase) {
        // initiate collection only when there was actual change
        if (valueBase !== null && this._currentValueBase === valueBase) {
            return;
        }

        this._currentValueBase = valueBase;
        this._currentValue = collect(this._node);

        // clear validity while collecting, and report on outcome
        if (this.state.isValid) {
            this.props.onInvalidation && this.props.onInvalidation();
        }

        this.setState({ isValid: false });

        const value = this._currentValue;
        this._currentValue.then(() => {
            // ignore if obsolete result
            if (this._currentValue !== value) {
                return;
            }

            this.setState({ isValid: true });
            this.props.onValidation && this.props.onValidation();
        });
    }

    render() {
        return React.cloneElement(this.props.children(this.state.isValid, this._update.bind(this)), {
            ref: (node) => {
                this._node = node;
            }
        })
    }
}

module.exports = {
    connect: connect,
    collect: collect,

    Map: Map,
    Pass: Pass,
    Status: Status,
    Value: Value,
    Debouncer: Debouncer,
    Prevalidator: Prevalidator,
    InputError: InputError
};
