const React = require('react');
const ReactDOM = require('react-dom');
const PropTypes = require('prop-types');

// generic input data collection error indicating an issue with upstream value
// upstream errors are handled separately, so this error report is a minimal sentinel object
class InputError extends Error {
    constructor() {
        super('Input error'); // generic text message suitable enough for e.g. a form

        this.name = 'InputError'; // @todo is there a way to do this via super()?
    }
}

function createCollectableSource(parentContext) {
    return class CollectableSource extends React.PureComponent {
        componentDidMount() {
            parentContext._registerCurrentSource(this);
        }

        componentWillUnmount() {
            parentContext._unregisterCurrentSource(this);
        }

        _collect() {
            return this.props.value();
        }

        render() {
            return React.Children.only(this.props.children);
        }
    }
}

class Context extends React.PureComponent {
    constructor(props) {
        super();

        this._sourceComponent = createCollectableSource(this);
        this._currentSource = null;
    }

    getChildContext() {
        return {
            collectableSourceImpl: this._sourceComponent
        };
    }

    _registerCurrentSource(source) {
        if (this._currentSource !== null) {
            throw new Error('source already registered');
        }

        this._currentSource = source;
    }

    _unregisterCurrentSource(source) {
        if (this._currentSource !== source) {
            throw new Error('unrecognized source cannot be registered');
        }

        this._currentSource = null;
    }

    collect() {
        if (this._currentSource === null) {
            throw new Error('no source registered');
        }

        return this._currentSource._collect();
    }

    render() {
        const children = this.props.children;

        // if function-as-child, expose the collection function directly
        return typeof children === 'function'
            ? children(() => this.collect())
            : React.Children.only(children);
    }
}

Context.childContextTypes = {
    collectableSourceImpl: PropTypes.func.isRequired
}

function Source(props, context) {
    const sourceImpl = context.collectableSourceImpl;

    if (!sourceImpl) {
        throw new Error('must be inside collectable context');
    }

    return React.createElement(
        sourceImpl,
        { value: props.value },
        React.Children.only(props.children)
    );
}

Source.contextTypes = {
    collectableSourceImpl: PropTypes.func.isRequired
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
            let refNode = null;

            return React.createElement(Context, { ref: (node) => {
                if (node) {
                    setNode(parameterName, node);
                } else {
                    unsetNode(parameterName, refNode);
                }

                refNode = node;
            } }, React.Children.only(props.children));
        };
    }

    _collectValue() {
        // get filter or default passthrough
        const filter = this.props.filter || (value => value);

        if (typeof filter !== 'function') {
            throw new Error('filter should be a function');
        }

        // wrap collection itself into promise body to catch and report developer errors
        return new Promise(resolve => {
            const nameList = Object.keys(this._nodeMap);
            const valuePromiseList = nameList.map((name) => this._nodeMap[name].collect());

            resolve(Promise.all(valuePromiseList).then((valueList) => {
                const result = Object.create(null);

                nameList.forEach((name, i) => {
                    result[name] = valueList[i];
                });

                // filter error is reported in promise as well
                return filter(result);
            }, () => {
                // report typical parameter value rejection (but not filter errors)
                throw new InputError();
            }));
        });
    }

    render() {
        return React.createElement(Source, { value: () => this._collectValue() }, (
            this.props.children(this._parameterComponent)
        ));
    }
}

// intercept collectable promises and track latest status
class Status extends React.PureComponent {
    constructor(props) {
        super();

        this._subContextNode = null;

        this.state = {
            currentCollection: null,
            inputError: null
        }
    }

    _collectValue() {
        const collection = this._subContextNode.collect();

        this._onPending(collection);

        collection.then(() => {
            this._onCompletion(collection, null);
        }, (error) => {
            this._onCompletion(collection, error);
        });

        return collection;
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

        // set up source and a sub-context
        return React.createElement(Source, { value: () => this._collectValue() }, (
            React.createElement(Context, { ref: (node) => this._subContextNode = node }, (
                this.props.children(inputError, isPending)
            ))
        ));
    }
}

// filter DOM input value through validation and feed it up into collectable pipeline
// @todo allow cases with sticky pre-validation - i.e. when pre-validated just use that value immediately
// (may still be best done outside of this component, but need the recipe)
class Input extends React.PureComponent {
    _collectValue() {
        // get filter or default passthrough
        const filter = this.props.filter || (value => value);

        if (typeof filter !== 'function') {
            throw new Error('filter should be a function');
        }

        const inputValue = this._getInputValue();

        // wrap possible synchronous errors in a promise
        // @todo this generates a console error still, on rejection (even though things work as expected otherwise)
        // @todo treat undefined filter result as simple pass-through
        const result = new Promise((resolve) => {
            resolve(filter(inputValue));
        });

        return result;
    }

    _getInputValue() {
        // @todo radio support, etc? should be separate pattern
        const inputNode = ReactDOM.findDOMNode(this);

        // report the DOM node value (per pattern mentioend in React form docs)
        return (inputNode.type === 'checkbox' || inputNode.type === 'radio')
            ? inputNode.checked
            : inputNode.value;
    }

    render() {
        return React.createElement(Source, { value: () => this._collectValue() }, (
            React.Children.only(this.props.children)
        ));
    }
}

class Debouncer extends React.PureComponent {
    constructor(props) {
        if (props.delayMs === undefined) {
            throw new Error('must define debounce delay');
        }

        super();

        this._subContextNode = null;

        this.state = { currentTimeoutId: null };
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
            return this._subContextNode.collect();
        });
    }

    render() {
        // set up source and a sub-context
        return React.createElement(Source, { value: () => this._collectValue() }, (
            React.createElement(Context, { ref: (node) => this._subContextNode = node }, (
                this.props.children(this.state.currentTimeoutId !== null)
            ))
        ));
    }
}

class Prevalidator extends React.PureComponent {
    constructor() {
        super();

        this._subContextNode = null;

        this._currentValueBase = null;
        this._currentValue = Promise.reject();

        this.state = { isValid: false };
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
        this._currentValue = this._subContextNode.collect();

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
        return React.createElement(Source, { value: () => this._collectValue() }, (
            React.createElement(Context, { ref: (node) => this._subContextNode = node }, (
                this.props.children(this.state.isValid, this._update.bind(this))
            ))
        ));
    }
}

module.exports = {
    Context: Context,
    Source: Source,

    Map: Map,
    Status: Status,
    Input: Input,
    Debouncer: Debouncer,
    Prevalidator: Prevalidator,
    InputError: InputError
};
