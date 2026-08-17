import { useAuthContext } from '~/hooks';

export default function useAuthRedirect() {
  const { user, roles, isAuthenticated } = useAuthContext();

  return {
    user,
    roles,
    isAuthenticated,
  };
}
