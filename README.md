# react-collectable

Promise-based form validation logic for React.

Approach:

- based on Promises
- declarative, JSX-oriented
- some assembly effort required
- composition using [function-as-child](https://medium.com/merrickchristensen/function-as-child-components-5f3920a9ace9) technique

Brief feature outline:

- asynchronous validation support
- pluggable, minimal and flexible

## Sample Code

Sample code:

```
<Context>{(collect) => <Map>{(Parameter) =>
    <form onSubmit={() => doSomeAction(collect())} action="javascript:void(0)">
        <Parameter name="name"><Status>{(error, isPending) =>
            <label data-error={!!error}>
                <span>Name</span>
                <Input filter={requireText}><input
                    type="text"
                    placeholder="Enter Email"
                /></Input>
            </label>
        }</Status></Parameter>

        <Parameter name="email"><Status>{(error, isPending) =>
            <label data-error={!!error}>
                <span>Email</span>
                <Input filter={requireText}><input
                    type="text"
                    placeholder="Enter Email"
                /></Input>
            </label>
        }</Status></Parameter>

        <button type="submit">Submit</button>
    </form>
}</Map> }</Context>
```

Notes:

- `requireText` is a validation filter function
- `doSomeAction` receives a promise of the validated input data

## To Do

- brief example
- sort out ES6 compilation
- test on Babel
