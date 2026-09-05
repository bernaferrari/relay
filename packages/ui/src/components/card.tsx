import { type ComponentProps, type JSX, splitProps, Show } from "solid-js";

export interface CardProps extends ComponentProps<"div"> {
  padding?: "sm" | "md" | "lg";
}

export function Card(props: CardProps) {
  const [split, rest] = splitProps(props, ["padding", "class", "classList", "children"]);
  return (
    <div
      {...rest}
      data-component="card"
      data-padding={split.padding || "md"}
      class={`block min-w-0 rounded-lg border border-[var(--border-weak-base)] bg-[var(--surface-raised-stronger-non-alpha)] shadow-sm data-[padding=sm]:p-2 data-[padding=md]:p-3 data-[padding=lg]:p-4 ${split.class ?? ""}`}
      classList={split.classList}
    >
      {split.children}
    </div>
  );
}

export function CardTitle(props: ComponentProps<"h3">) {
  const [split, rest] = splitProps(props, ["class", "classList", "children"]);
  return (
    <h3
      {...rest}
      data-slot="card-title"
      class={`m-0 font-sans text-base font-medium leading-tight tracking-tight text-[var(--text-strong)] ${split.class ?? ""}`}
      classList={split.classList}
    >
      {split.children}
    </h3>
  );
}

export function CardDescription(props: { children?: JSX.Element; class?: string }) {
  return (
    <p
      data-slot="card-description"
      class={`mt-1 font-sans text-xs leading-5 text-[var(--text-weak)] ${props.class ?? ""}`}
    >
      {props.children}
    </p>
  );
}

export function CardHeader(props: {
  title?: string;
  description?: string;
  children?: JSX.Element;
  class?: string;
}) {
  return (
    <div data-slot="card-header" class={`mb-3 ${props.class ?? ""}`}>
      <Show when={props.title}>
        <CardTitle>{props.title}</CardTitle>
      </Show>
      <Show when={props.description}>
        <CardDescription>{props.description}</CardDescription>
      </Show>
      {props.children}
    </div>
  );
}
