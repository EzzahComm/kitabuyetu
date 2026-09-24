import React from 'react';
import { cn } from '@/lib/utils';

interface ContainerProps {
  children: React.ReactNode;
  className?: string;
}

export function Container(props: Readonly<ContainerProps>) {
  // py-8 stays outside cn(): it has always beaten callers' py-12/py-16 (stylesheet order), and pages rely on that.
  return (
    <div className={`${cn('mx-auto w-full max-w-[82rem] px-5 sm:px-8 lg:px-10', props.className)} py-8`}>
      {props.children}
    </div>
  );
}
