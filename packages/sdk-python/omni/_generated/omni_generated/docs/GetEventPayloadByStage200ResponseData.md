# GetEventPayloadByStage200ResponseData


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
from omni_generated.models.get_event_payload_by_stage200_response_data import GetEventPayloadByStage200ResponseData

# TODO update the JSON string below
json = "{}"
# create an instance of GetEventPayloadByStage200ResponseData from a JSON string
get_event_payload_by_stage200_response_data_instance = GetEventPayloadByStage200ResponseData.from_json(json)
# print the JSON string representation of the object
print(GetEventPayloadByStage200ResponseData.to_json())

# convert the object into a dict
get_event_payload_by_stage200_response_data_dict = get_event_payload_by_stage200_response_data_instance.to_dict()
# create an instance of GetEventPayloadByStage200ResponseData from a dict
get_event_payload_by_stage200_response_data_from_dict = GetEventPayloadByStage200ResponseData.from_dict(get_event_payload_by_stage200_response_data_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


