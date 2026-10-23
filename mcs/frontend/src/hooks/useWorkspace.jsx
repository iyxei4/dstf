import { createContext, useContext, useState, useEffect } from "react";
import { request } from "../utils/api";

const WorkspaceContext = createContext({
  currentWorkspace: null,
  loading: true,
  error: null,
});

export const useWorkspace = () => useContext(WorkspaceContext);

export const WorkspaceProvider = ({ children }) => {
  const [currentWorkspace, setCurrentWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadWorkspace = async () => {
      try {
        const data = await request("/user/workspace");
        setCurrentWorkspace(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadWorkspace();
  }, []);

  return (
    <WorkspaceContext.Provider value={{ currentWorkspace, loading, error }}>
      {children}
    </WorkspaceContext.Provider>
  );
};