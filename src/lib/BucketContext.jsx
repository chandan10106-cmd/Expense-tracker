import { createContext, useContext, useState } from 'react';

const BucketContext = createContext(null);

export const BucketProvider = ({ children }) => {
  const [activeBucket, setActiveBucket] = useState(null);
  const clearBucket = () => setActiveBucket(null);
  return (
    <BucketContext.Provider value={{ activeBucket, setActiveBucket, clearBucket }}>
      {children}
    </BucketContext.Provider>
  );
};

export const useBucket = () => useContext(BucketContext);
