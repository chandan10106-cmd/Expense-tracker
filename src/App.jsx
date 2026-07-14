import { useAuth } from './lib/AuthContext';
import { useBucket } from './lib/BucketContext';
import AuthPage from './pages/AuthPage';
import AppHome from './pages/AppHome';
import BucketPicker from './pages/BucketPicker';

const App = () => {
  const { user, loading } = useAuth();
  const { activeBucket } = useBucket();

  if (loading) {
    return (
      <div className="loading-shell">
        <div className="spinner"></div>
      </div>
    );
  }

  if (!user) return <AuthPage />;
  if (!activeBucket) return <BucketPicker />;
  return <AppHome />;
};

export default App;
