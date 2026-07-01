
import React from 'react';
import { BrainCircuitIcon } from './icons';

export const Header: React.FC = () => {
  return (
    <header className="bg-brand-secondary/50 backdrop-blur-sm sticky top-0 z-10">
      <div className="container mx-auto px-4 md:px-8 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <BrainCircuitIcon className="h-8 w-8 text-brand-green" />
          <h1 className="text-xl md:text-2xl font-bold text-brand-text tracking-wider">
            Investment Discovery Engine
          </h1>
        </div>
      </div>
    </header>
  );
};
