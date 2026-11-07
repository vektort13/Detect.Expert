// Generic state block: title + explanation lines, toned (neutral / muted / attention / error). Used for every
// coverage state, restricted pages, unsupported Chrome, scope off and an unreachable background process.

import type { ComponentChildren } from 'preact';
import { tm } from '../i18n';
import type { Tone } from '../view-models/coverage';
import type { Message } from '../view-models/message';

export interface StateMessageProps {
  id: string;
  tone: Tone;
  title: Message;
  lines: ReadonlyArray<Message>;
  children?: ComponentChildren;
}

export function StateMessage(props: StateMessageProps) {
  const headingId = props.id + '-title';
  return (
    <section id={props.id} class={'state state--' + props.tone} aria-labelledby={headingId}>
      <h2 id={headingId} class="state__title" tabIndex={-1}>
        {tm(props.title)}
      </h2>
      {props.lines.map((line, index) => (
        <p key={index} class="state__line">
          {tm(line)}
        </p>
      ))}
      {props.children}
    </section>
  );
}
