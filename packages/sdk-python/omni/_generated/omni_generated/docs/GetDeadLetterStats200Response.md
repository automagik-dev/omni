# GetDeadLetterStats200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**GetDeadLetterStats200ResponseData**](GetDeadLetterStats200ResponseData.md) |  | 

## Example

```python
from omni_generated.models.get_dead_letter_stats200_response import GetDeadLetterStats200Response

# TODO update the JSON string below
json = "{}"
# create an instance of GetDeadLetterStats200Response from a JSON string
get_dead_letter_stats200_response_instance = GetDeadLetterStats200Response.from_json(json)
# print the JSON string representation of the object
print(GetDeadLetterStats200Response.to_json())

# convert the object into a dict
get_dead_letter_stats200_response_dict = get_dead_letter_stats200_response_instance.to_dict()
# create an instance of GetDeadLetterStats200Response from a dict
get_dead_letter_stats200_response_from_dict = GetDeadLetterStats200Response.from_dict(get_dead_letter_stats200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


