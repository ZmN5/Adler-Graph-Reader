import React, { useState, useEffect, useCallback } from 'react';
import { documentsApi, Document } from '../services/api';

const DocumentsPage: React.FC = () => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const fetchDocuments = useCallback(async () => {
    try {
      setLoading(true);
      const data = await documentsApi.getAll();
      setDocuments(data);
      setError(null);
    } catch (err) {
      setError('加载文档失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      await documentsApi.upload(file);
      await fetchDocuments();
    } catch (err) {
      setError('上传文档失败');
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个文档吗？')) return;
    
    try {
      await documentsApi.delete(id);
      await fetchDocuments();
    } catch (err) {
      setError('删除文档失败');
      console.error(err);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('zh-CN');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">文档管理</h1>
        <label className="btn btn-primary cursor-pointer">
          <input
            type="file"
            accept=".txt,.pdf,.doc,.docx,.md"
            onChange={handleFileUpload}
            className="hidden"
            disabled={uploading}
          />
          {uploading ? '上传中...' : '+ 导入文档'}
        </label>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {documents.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg mb-2">暂无文档</p>
          <p>点击上方按钮导入您的第一个文档</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {documents.map((doc) => (
            <div key={doc.id} className="card flex justify-between items-start">
              <div className="flex-1">
                <h3 className="font-semibold text-lg mb-1">{doc.title}</h3>
                <div className="text-sm text-gray-500 space-x-4">
                  <span>类型: {doc.source_type}</span>
                  <span>创建: {formatDate(doc.created_at)}</span>
                </div>
              </div>
              <button
                onClick={() => handleDelete(doc.id)}
                className="btn btn-danger text-sm ml-4"
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DocumentsPage;
