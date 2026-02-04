# GetPayloadStats200ResponseDataByStage

Count by stage

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**webhook_raw** | **int** |  | [optional] 
**agent_request** | **int** |  | [optional] 
**agent_response** | **int** |  | [optional] 
**channel_send** | **int** |  | [optional] 
**error** | **int** |  | [optional] 

## Example

```python
from omni_generated.models.get_payload_stats200_response_data_by_stage import GetPayloadStats200ResponseDataByStage

# TODO update the JSON string below
json = "{}"
# create an instance of GetPayloadStats200ResponseDataByStage from a JSON string
get_payload_stats200_response_data_by_stage_instance = GetPayloadStats200ResponseDataByStage.from_json(json)
# print the JSON string representation of the object
print(GetPayloadStats200ResponseDataByStage.to_json())

# convert the object into a dict
get_payload_stats200_response_data_by_stage_dict = get_payload_stats200_response_data_by_stage_instance.to_dict()
# create an instance of GetPayloadStats200ResponseDataByStage from a dict
get_payload_stats200_response_data_by_stage_from_dict = GetPayloadStats200ResponseDataByStage.from_dict(get_payload_stats200_response_data_by_stage_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


