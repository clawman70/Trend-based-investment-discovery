
import React from 'react';

interface LoaderProps {
  message?: string;
}

export const Loader: React.FC<LoaderProps> = ({ message }) => (
  <div className="flex flex-col items-center justify-center my-16">
    <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-brand-green"></div>
    <p className="mt-4 text-lg text-brand-light">{message || 'Analyzing trends and fetching data...'}</p>
  </div>
);