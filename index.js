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

// allow user to submit collectable data and report the first eventual successful value
// (can be collected right away, but does not trigger child collection without call to invoke)
class Root extends React.PureComponent {
    constructor(props) {
        super();

        this._contentsNode = null;
        this._currentCollection = null;
        this._isResolved = false;

        // always promise the same one possible result
        this._result = new Promise((resolve) => {
            this._resolve = resolve;
        });

        connect(this, () => this._result);
    }

    _submit() {
        // disallow re-submit if already succeeded
        if (this._isResolved) {
            throw new Error('already resolved');
        }

        // disallow re-submit while pending
        if (this._currentCollection) {
            throw new Error('already submitted');
        }

        this._currentCollection = collect(this._contentsNode);

        // on success, prevent further submit and report to parent
        this._currentCollection.then((v) => {
            this._currentCollection = null; // always clear pending state for consistency
            this._isResolved = true;

            // @todo pipe in original resolved promise instead if the value itself? for more debug info?
            this._resolve(v);
        }, () => {
            // simply allow retrying again
            this._currentCollection = null;
        });
    }

    render() {
        const contents = this.props.children(
            () => this._submit()
        );

        return React.cloneElement(contents, {
            ref: (node) => { this._contentsNode = node; }
        });
    }
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

        connect(this, () => collect(this._passNode));
    }

    render() {
        return this.props.children(this._passComponent);
    }
}

// intercept collectable promises and track latest status
class Status extends React.PureComponent {
    constructor(props) {
        super();

        this._inputNode = null;

        this.state = {
            currentCollection: null,
            inputError: null
        }

        connect(this, () => {
            const collection = collect(this._inputNode);

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

// filter DOM input value through validation and feed it up into collectable pipeline
// @todo allow cases with sticky pre-validation - i.e. when pre-validated just use that value immediately
// (may still be best done outside of this component, but need the recipe)
class Input extends React.PureComponent {
    constructor() {
        super();

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

        return result;
    }

    _getInputValue() {
        // @todo radio, checkbox support, etc? should be separate pattern
        const inputNode = ReactDOM.findDOMNode(this);

        // report the DOM node value
        return inputNode.value;
    }

    render() {
        return React.Children.only(this.props.children);
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

    Root: Root,
    Map: Map,
    Pass: Pass,
    Status: Status,
    Input: Input,
    Debouncer: Debouncer,
    Prevalidator: Prevalidator,
    InputError: InputError
};
