# PayloadMetadata


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **UUID** | Payload UUID | 
**event_id** | **UUID** | Event UUID | 
**stage** | **str** | Payload stage | 
**mime_type** | **str** | MIME type | 
**size_bytes** | **int** | Size in bytes | 
**has_data** | **bool** | Whether data is available | 
**created_at** | **datetime** | Creation timestamp | 

## Example

```python
from omni_generated.models.payload_metadata import PayloadMetadata

# TODO update the JSON string below
json = "{}"
# create an instance of PayloadMetadata from a JSON string
payload_metadata_instance = PayloadMetadata.from_json(json)
# print the JSON string representation of the object
print(PayloadMetadata.to_json())

# convert the object into a dict
payload_metadata_dict = payload_metadata_instance.to_dict()
# create an instance of PayloadMetadata from a dict
payload_metadata_from_dict = PayloadMetadata.from_dict(payload_metadata_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


