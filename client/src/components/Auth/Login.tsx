import { useAuthContext } from '~/hooks/AuthContext';
import ApiKeyLoginForm from './ApiKeyLoginForm';

function Login() {
  const { error, apiKeyLogin } = useAuthContext();

  return (
    <div className="relative">
      <ApiKeyLoginForm onSubmit={apiKeyLogin} error={error ? String(error) : null} />
    </div>
  );
}

export default Login;
