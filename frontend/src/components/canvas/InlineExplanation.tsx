import { Fragment } from "react";
import { renderInline } from "../../lib/inline";
import { parseAnswerSegments } from "../../lib/termparser";

interface Props {
  text: string;
  keyTerms: readonly string[];
  onExplain: (term: string, passage: string) => void;
  disabled?: boolean;
}

/** A readable explanation with inline, keyboard-accessible concept links. */
export function InlineExplanation({ text, keyTerms, onExplain, disabled = false }: Props) {
  return <>{renderInline(text).map((part, index) => {
    const content = parseAnswerSegments(part.text, keyTerms).map((segment, i) => segment.kind === "text" ? (
      <Fragment key={i}>{segment.text}</Fragment>
    ) : (
      <button
        key={i}
        type="button"
        className="term-highlight nodrag nopan"
        data-explain-term={segment.term}
        title={`Explain “${segment.term}” in a connected card`}
        aria-label={`Explain ${segment.term}`}
        disabled={disabled}
        onClick={(event) => { event.stopPropagation(); onExplain(segment.term.replace(/\s+/g, " ").trim(), text); }}
      >
        {segment.term}
      </button>
    ));
    return part.bold ? <strong key={index}>{content}</strong> : part.italic ? <em key={index}>{content}</em> : <Fragment key={index}>{content}</Fragment>;
  })}</>;
}
