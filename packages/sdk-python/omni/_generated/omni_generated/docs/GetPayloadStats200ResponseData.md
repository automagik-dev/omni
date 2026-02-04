# GetPayloadStats200ResponseData


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**total_payloads** | **int** | Total payloads | 
**total_size_bytes** | **int** | Total size | 
**by_stage** | [**GetPayloadStats200ResponseDataByStage**](GetPayloadStats200ResponseDataByStage.md) |  | 
**oldest_payload** | **datetime** | Oldest payload date | 

## Example

```python
from omni_generated.models.get_payload_stats200_response_data import GetPayloadStats200ResponseData

# TODO update the JSON string below
json = "{}"
# create an instance of GetPayloadStats200ResponseData from a JSON string
get_payload_stats200_response_data_instance = GetPayloadStats200ResponseData.from_json(json)
# print the JSON string representation of the object
print(GetPayloadStats200ResponseData.to_json())

# convert the object into a dict
get_payload_stats200_response_data_dict = get_payload_stats200_response_data_instance.to_dict()
# create an instance of GetPayloadStats200ResponseData from a dict
get_payload_stats200_response_data_from_dict = GetPayloadStats200ResponseData.from_dict(get_payload_stats200_response_data_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


