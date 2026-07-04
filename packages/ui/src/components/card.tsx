import { type ComponentProps, type JSX, splitProps, Show } from "solid-js";
import "./card.css";

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
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
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
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      {split.children}
    </h3>
  );
}

export function CardDescription(props: { children?: JSX.Element; class?: string }) {
  return (
    <p data-slot="card-description" class={props.class}>
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
    <div data-slot="card-header" class={props.class} style={{ "margin-bottom": "0.75rem" }}>
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
