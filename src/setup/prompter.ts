import * as clack from "@clack/prompts";

export interface Choice<T> {
  value: T;
  label: string;
  hint?: string;
}

/** Everything the setup flow asks or shows. The TUI uses clack; tests script the answers. */
export interface Prompter {
  intro(title: string): void;
  outro(message: string): void;
  note(body: string, title?: string): void;
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  text(o: { message: string; placeholder?: string; initial?: string; optional?: boolean; validate?: (v: string) => string | undefined }): Promise<string>;
  password(o: { message: string }): Promise<string>;
  confirm(o: { message: string; initial?: boolean }): Promise<boolean>;
  select<T>(o: { message: string; options: Choice<T>[]; initial?: T }): Promise<T>;
  multiselect<T>(o: { message: string; options: Choice<T>[]; initial?: T[]; required?: boolean }): Promise<T[]>;
  /** run work behind a spinner; `done` turns the result into the final line */
  spin<T>(message: string, work: () => Promise<T>, done?: (r: T) => string): Promise<T>;
}

/** Thrown when the user presses Ctrl+C / Esc in a prompt. */
export class Cancelled extends Error {
  constructor() {
    super("setup cancelled");
  }
}

function unwrap<T>(v: T): Exclude<T, symbol> {
  if (clack.isCancel(v)) throw new Cancelled();
  return v as Exclude<T, symbol>;
}

export const clackPrompter: Prompter = {
  intro: (t) => clack.intro(t),
  outro: (m) => clack.outro(m),
  note: (b, t) => clack.note(b, t),
  info: (m) => clack.log.info(m),
  success: (m) => clack.log.success(m),
  warn: (m) => clack.log.warn(m),
  async text(o) {
    const v = unwrap(
      await clack.text({
        message: o.message,
        placeholder: o.placeholder,
        initialValue: o.initial,
        validate: (raw) => {
          const s = (raw ?? "").trim();
          if (!s && !o.optional) return "Required";
          return s ? o.validate?.(s) : undefined;
        },
      }),
    );
    return (v ?? "").trim();
  },
  async password(o) {
    return unwrap(await clack.password({ message: o.message, validate: (v) => (v ? undefined : "Required") }));
  },
  async confirm(o) {
    return unwrap(await clack.confirm({ message: o.message, initialValue: o.initial ?? true }));
  },
  async select<T>(o: { message: string; options: Choice<T>[]; initial?: T }) {
    return unwrap(await clack.select<T>({ message: o.message, options: o.options as any, initialValue: o.initial }));
  },
  async multiselect<T>(o: { message: string; options: Choice<T>[]; initial?: T[]; required?: boolean }) {
    return unwrap(await clack.multiselect<T>({ message: o.message, options: o.options as any, initialValues: o.initial, required: o.required ?? false }));
  },
  async spin(message, work, done) {
    const s = clack.spinner();
    s.start(message);
    try {
      const r = await work();
      s.stop(done ? done(r) : message);
      return r;
    } catch (e: any) {
      s.error(`${message}: ${e?.message ?? e}`);
      throw e;
    }
  },
};
