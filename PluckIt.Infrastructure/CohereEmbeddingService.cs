using System;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using PluckIt.Core;

namespace PluckIt.Infrastructure;

public class CohereEmbeddingService : IEmbeddingService
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<CohereEmbeddingService> _logger;

    public CohereEmbeddingService(IHttpClientFactory httpClientFactory, IConfiguration config, ILogger<CohereEmbeddingService> logger)
    {
        _logger = logger;
        
        var endpoint = config["Cohere__Endpoint"];
        var apiKey = config["Cohere__ApiKey"];

        if (string.IsNullOrEmpty(endpoint) || string.IsNullOrEmpty(apiKey))
        {
            _logger.LogWarning("Cohere endpoint or API key is not configured. Embeddings will not be generated.");
        }

        _httpClient = httpClientFactory.CreateClient("CohereEmbedClient");
        if (!string.IsNullOrEmpty(endpoint))
        {
            _httpClient.BaseAddress = new Uri(endpoint);
        }
        
        if (!string.IsNullOrEmpty(apiKey))
        {
            _httpClient.DefaultRequestHeaders.Add("Authorization", $"Bearer {apiKey}");
        }
    }

    public async Task<float[]> EmbedImageAsync(string imageDataUri, CancellationToken cancellationToken = default)
    {
        if (_httpClient.BaseAddress == null) return Array.Empty<float>();

        var requestBody = new
        {
            input_type = "image",
            embedding_types = new[] { "float" },
            images = new[] { imageDataUri }
        };

        return await GetEmbeddingsAsync(requestBody, cancellationToken);
    }

    public async Task<float[]> EmbedTextAsync(string text, CancellationToken cancellationToken = default)
    {
        if (_httpClient.BaseAddress == null) return Array.Empty<float>();

        var requestBody = new
        {
            input_type = "search_query",
            embedding_types = new[] { "float" },
            texts = new[] { text }
        };

        return await GetEmbeddingsAsync(requestBody, cancellationToken);
    }

    private async Task<float[]> GetEmbeddingsAsync(object requestBody, CancellationToken cancellationToken)
    {
        try
        {
            var response = await _httpClient.PostAsJsonAsync("/v1/embed", requestBody, cancellationToken);
            
            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync(cancellationToken);
                _logger.LogError("Cohere embedding API returned {Status}: {Error}", response.StatusCode, errorBody);
                return Array.Empty<float>();
            }

            var result = await response.Content.ReadFromJsonAsync<CohereEmbedResponse>(cancellationToken: cancellationToken);
            if (result?.Embeddings?.Float != null && result.Embeddings.Float.Length > 0 && result.Embeddings.Float[0] != null)
            {
                return result.Embeddings.Float[0];
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to generate embeddings from Cohere.");
        }

        return Array.Empty<float>();
    }

    private class CohereEmbedResponse
    {
        public CohereEmbeddings Embeddings { get; set; } = new();
    }

    private class CohereEmbeddings
    {
        public float[][]? Float { get; set; }
    }
}
