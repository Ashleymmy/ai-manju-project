import type { ReactNode } from "react";

export type PageIntroCopy = {
  code: string;
  title: string;
  subtitle: string;
};

export function PageIntro({
  copy,
  action,
}: {
  copy: PageIntroCopy;
  action?: ReactNode;
}) {
  return (
    <div className="page-intro">
      <div>
        <p className="eyebrow">{copy.code}</p>
        <h1>{copy.title}</h1>
        <p>{copy.subtitle}</p>
      </div>
      {action}
    </div>
  );
}
