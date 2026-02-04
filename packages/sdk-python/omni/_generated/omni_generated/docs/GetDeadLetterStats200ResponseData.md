# GetDeadLetterStats200ResponseData


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**total** | **int** | Total count | 
**pending** | **int** | Pending count | 
**retrying** | **int** | Retrying count | 
**resolved** | **int** | Resolved count | 
**abandoned** | **int** | Abandoned count | 
**by_event_type** | **Dict[str, float]** | Count by event type | 

## Example

```python
from omni_generated.models.get_dead_letter_stats200_response_data import GetDeadLetterStats200ResponseData

# TODO update the JSON string below
json = "{}"
# create an instance of GetDeadLetterStats200ResponseData from a JSON string
get_dead_letter_stats200_response_data_instance = GetDeadLetterStats200ResponseData.from_json(json)
# print the JSON string representation of the object
print(GetDeadLetterStats200ResponseData.to_json())

# convert the object into a dict
get_dead_letter_stats200_response_data_dict = get_dead_letter_stats200_response_data_instance.to_dict()
# create an instance of GetDeadLetterStats200ResponseData from a dict
get_dead_letter_stats200_response_data_from_dict = GetDeadLetterStats200ResponseData.from_dict(get_dead_letter_stats200_response_data_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


