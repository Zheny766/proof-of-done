'use client';

import { useEffect } from 'react';

// The browser words its own form warnings ("Please fill out this field", the email "@" hint) in the
// visitor's language, so a Russian browser showed Russian bubbles on an English site. This gives
// every field an English message instead; typing clears it, and the browser checks again on submit.

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function message(el: Field): string {
  const v = el.validity;
  const input = el as HTMLInputElement;
  if (v.valueMissing) return 'Please fill in this field.';
  if (v.typeMismatch) return input.type === 'email' ? 'Enter an email address, like name@example.com.' : input.type === 'url' ? 'Enter a web address that starts with https://.' : 'This value is not valid.';
  if (v.badInput) return 'Enter a number.';
  if (v.rangeUnderflow) return `Use ${input.min} or more.`;
  if (v.rangeOverflow) return `Use ${input.max} or less.`;
  if (v.stepMismatch) return Number(input.step) >= 1 ? 'Use a whole number.' : 'Use at most two decimal places.';
  if (v.tooShort) return `Use at least ${input.minLength} characters.`;
  if (v.tooLong) return `Use at most ${input.maxLength} characters.`;
  return 'This value is not valid.';
}

const isField = (t: EventTarget | null): t is Field => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;

export function EnglishValidation() {
  useEffect(() => {
    const onInvalid = (e: Event) => {
      if (!isField(e.target)) return;
      e.target.setCustomValidity('');
      if (!e.target.validity.valid) e.target.setCustomValidity(message(e.target));
    };
    const onEdit = (e: Event) => {
      if (isField(e.target)) e.target.setCustomValidity('');
    };
    document.addEventListener('invalid', onInvalid, true);
    document.addEventListener('input', onEdit, true);
    document.addEventListener('change', onEdit, true);
    return () => {
      document.removeEventListener('invalid', onInvalid, true);
      document.removeEventListener('input', onEdit, true);
      document.removeEventListener('change', onEdit, true);
    };
  }, []);
  return null;
}
