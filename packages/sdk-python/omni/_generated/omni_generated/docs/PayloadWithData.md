# PayloadWithData


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
**payload** | **object** | Decompressed payload data | [optional] 

## Example

```python
from omni_generated.models.payload_with_data import PayloadWithData

# TODO update the JSON string below
json = "{}"
# create an instance of PayloadWithData from a JSON string
payload_with_data_instance = PayloadWithData.from_json(json)
# print the JSON string representation of the object
print(PayloadWithData.to_json())

# convert the object into a dict
payload_with_data_dict = payload_with_data_instance.to_dict()
# create an instance of PayloadWithData from a dict
payload_with_data_from_dict = PayloadWithData.from_dict(payload_with_data_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


