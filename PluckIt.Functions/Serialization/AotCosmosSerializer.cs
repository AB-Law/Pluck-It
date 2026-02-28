using System.Diagnostics.CodeAnalysis;
using System.IO;
using System.Text.Json;
using Microsoft.Azure.Cosmos;

namespace PluckIt.Functions.Serialization;

/// <summary>
/// AOT-safe Cosmos serializer that delegates to System.Text.Json source-generated
/// context instead of the Cosmos SDK's internal reflection-based serializer.
/// </summary>
internal sealed class AotCosmosSerializer : CosmosSerializer
{
    private readonly JsonSerializerOptions _options;

    public AotCosmosSerializer(JsonSerializerOptions options) => _options = options;

    // Suppress IL2026/IL3050: CosmosSerializer must handle a generic T that includes internal
    // Cosmos SDK types (query responses, throughput DTOs, etc.) — not only our model types.
    // All application model types are preserved via TrimmerRoots.xml.
    // Cosmos SDK assemblies are rooted by the CosmosClient reference in the binary.
    [UnconditionalSuppressMessage("Trimming", "IL2026")]
    [UnconditionalSuppressMessage("AOT", "IL3050")]
    public override T FromStream<T>(Stream stream)
    {
        using (stream)
            return JsonSerializer.Deserialize<T>(stream, _options)!;
    }

    [UnconditionalSuppressMessage("Trimming", "IL2026")]
    [UnconditionalSuppressMessage("AOT", "IL3050")]
    public override Stream ToStream<T>(T input)
    {
        var ms = new MemoryStream();
        JsonSerializer.Serialize(ms, input, typeof(T), _options);
        ms.Position = 0;
        return ms;
    }
}
