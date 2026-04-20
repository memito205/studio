
import React from 'react';

const Loader: React.FC = () => {
  return (
    <div className="flex justify-center items-center p-8">
      <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-green-600"></div>
    </div>
  );
};

export default Loader;
