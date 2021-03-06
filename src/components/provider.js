import VeeValidate from '../plugin';
import RuleContainer from '../core/ruleContainer';
import { normalizeEvents, isEvent } from '../utils/events';
import { createFlags, normalizeRules, warn, isCallable } from '../utils';
import { findModel, extractVNodes, addVNodeListener, getInputEventName, normalizeSlots } from '../utils/vnode';

let $validator = null;

export function createValidationCtx (ctx) {
  return {
    errors: ctx.messages,
    flags: ctx.flags,
    classes: ctx.classes,
    valid: ctx.isValid,
    aria: {
      'aria-invalid': ctx.flags.invalid ? 'true' : 'false',
      'aria-required': ctx.isRequired ? 'true' : 'false'
    }
  };
}

export function onRenderUpdate (model) {
  let validateNow = this.value !== model.value || this._needsValidation;
  let shouldRevalidate = this.flags.validated;
  if (!this.initialized) {
    this.initialValue = model.value;
  }

  if (validateNow) {
    const silentHandler = ({ valid }) => {
      // initially assign the valid/invalid flags.
      this.setFlags({
        valid,
        invalid: !valid
      });
    };

    this.syncValue(model.value);
    this.validate().then(this.immediate || shouldRevalidate ? this.applyResult : silentHandler);
  }

  this._needsValidation = false;
}

// Creates the common listeners for a validatable context.
export function createCommonListeners (ctx) {
  const onInput = (e) => {
    ctx.syncValue(e); // track and keep the value updated.
    ctx.setFlags({ dirty: true, pristine: false });
  };

  // Blur event listener.
  const onBlur = () => {
    ctx.setFlags({ touched: true, untouched: false });
  };

  return { onInput, onBlur };
}

// Adds all plugin listeners to the vnode.
function addListeners (node) {
  const model = findModel(node);
  // cache the input eventName.
  this._inputEventName = this._inputEventName || getInputEventName(node, model);

  onRenderUpdate.call(this, model);

  const { onInput, onBlur } = createCommonListeners(this);
  addVNodeListener(node, this._inputEventName, onInput);
  addVNodeListener(node, 'blur', onBlur);

  // add the validation listeners.
  this.normalizedEvents.forEach(evt => {
    addVNodeListener(node, evt, () => this.validate().then(this.applyResult));
  });

  this.initialized = true;
}

function createValuesLookup (ctx) {
  let providers = ctx.$_veeObserver.refs;

  return ctx.fieldDeps.reduce((acc, depName) => {
    if (providers[depName]) {
      acc[depName] = providers[depName].value;
      const unwatch = providers[depName].$watch('value', () => {
        ctx.validate(ctx.value).then(ctx.applyResult);
        unwatch();
      });
    }

    return acc;
  }, {});
}

function updateRenderingContextRefs (ctx) {
  const { id, vid } = ctx;

  // Nothing has changed.
  if (id === vid && ctx.$_veeObserver.refs[id]) {
    return;
  }

  // vid was changed.
  if (id !== vid && ctx.$_veeObserver.refs[id] === ctx) {
    ctx.$_veeObserver.$unsubscribe(ctx);
  }

  ctx.$_veeObserver.$subscribe(ctx);
  ctx.id = vid;
}

function createObserver () {
  return {
    refs: {},
    $subscribe (ctx) {
      this.refs[ctx.vid] = ctx;
    },
    $unsubscribe (ctx) {
      delete this.refs[ctx.vid];
    }
  };
}

let id = 0;

export const ValidationProvider = {
  $__veeInject: false,
  inject: {
    $_veeObserver: {
      from: '$_veeObserver',
      default () {
        if (!this.$vnode.context.$_veeObserver) {
          this.$vnode.context.$_veeObserver = createObserver();
        }

        return this.$vnode.context.$_veeObserver;
      }
    }
  },
  props: {
    vid: {
      type: [String, Number],
      default: () => {
        id++;
        return id;
      }
    },
    name: {
      type: String,
      default: null
    },
    events: {
      type: [Array, String],
      default: () => ['input']
    },
    rules: {
      type: [Object, String],
      default: null
    },
    immediate: {
      type: Boolean,
      default: false
    },
    tag: {
      type: String,
      default: 'span'
    }
  },
  watch: {
    rules: {
      deep: true,
      handler () {
        this._needsValidation = true;
      }
    }
  },
  data: () => ({
    messages: [],
    value: undefined,
    initialized: false,
    initialValue: undefined,
    flags: createFlags(),
    id: null
  }),
  methods: {
    setFlags (flags) {
      Object.keys(flags).forEach(flag => {
        this.flags[flag] = flags[flag];
      });
    },
    syncValue (e) {
      const value = isEvent(e) ? e.target.value : e;

      this.value = value;
    },
    reset () {
      this.messages = [];
      this.initialValue = this.value;
      const flags = createFlags();
      flags.changed = false;
      this.setFlags(flags);
    },
    validate () {
      this.setFlags({ pending: true });

      return $validator.verify(this.value, this.rules, {
        name: this.name,
        values: createValuesLookup(this)
      }).then(result => {
        this.setFlags({ pending: false });

        return result;
      });
    },
    applyResult ({ errors }) {
      this.messages = errors;
      this.setFlags({
        valid: !errors.length,
        changed: this.value !== this.initialValue,
        invalid: !!errors.length,
        validated: true
      });
    },
    registerField () {
      if (!$validator) {
        /* istanbul ignore next */
        if (process.env.NODE_ENV !== 'production') {
          if (!VeeValidate.instance) {
            warn('You must install vee-validate first before using this component.');
          }
        }

        $validator = VeeValidate.instance._validator;
      }

      updateRenderingContextRefs(this);
    }
  },
  computed: {
    isValid () {
      return this.flags.valid;
    },
    fieldDeps () {
      const rules = normalizeRules(this.rules);

      return Object.keys(rules).filter(RuleContainer.isTargetRule).map(rule => {
        return rules[rule][0];
      });
    },
    normalizedEvents () {
      return normalizeEvents(this.events).map(e => {
        if (e === 'input') {
          return this._inputEventName;
        }

        return e;
      });
    },
    isRequired () {
      const rules = normalizeRules(this.rules);

      return !!rules.required;
    },
    classes () {
      const names = VeeValidate.config.classNames;
      return Object.keys(this.flags).reduce((classes, flag) => {
        const className = (names && names[flag]) || flag;
        if (className) {
          classes[className] = this.flags[flag];
        }

        return classes;
      }, {});
    }
  },
  render (h) {
    this.registerField();
    const ctx = createValidationCtx(this);

    // Gracefully handle non-existent scoped slots.
    let slots = this.$scopedSlots.default;
    if (!isCallable(slots)) {
      if (process.env.NODE_ENV !== 'production') {
        warn('Did you forget to add a scoped slot to the ValidationProvider?');
      }

      slots = () => normalizeSlots(this.$slots, this.$vnode.context);
    }

    const nodes = slots(ctx);
    // Handle multi-root slot.
    extractVNodes(Array.isArray(nodes) ? { children: nodes } : nodes).forEach(input => {
      addListeners.call(this, input);
    });

    return h(this.tag, {
      attrs: this.$attrs
    }, nodes);
  },
  beforeDestroy () {
    // cleanup reference.
    this.$_veeObserver.$unsubscribe(this);
  }
};
