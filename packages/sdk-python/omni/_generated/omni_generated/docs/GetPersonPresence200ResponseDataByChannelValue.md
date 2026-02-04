# GetPersonPresence200ResponseDataByChannelValue


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**identities** | [**List[GetPersonPresence200ResponseDataIdentitiesInner]**](GetPersonPresence200ResponseDataIdentitiesInner.md) |  | 
**message_count** | **int** |  | 
**last_seen_at** | **datetime** |  | 

## Example

```python
from omni_generated.models.get_person_presence200_response_data_by_channel_value import GetPersonPresence200ResponseDataByChannelValue

# TODO update the JSON string below
json = "{}"
# create an instance of GetPersonPresence200ResponseDataByChannelValue from a JSON string
get_person_presence200_response_data_by_channel_value_instance = GetPersonPresence200ResponseDataByChannelValue.from_json(json)
# print the JSON string representation of the object
print(GetPersonPresence200ResponseDataByChannelValue.to_json())

# convert the object into a dict
get_person_presence200_response_data_by_channel_value_dict = get_person_presence200_response_data_by_channel_value_instance.to_dict()
# create an instance of GetPersonPresence200ResponseDataByChannelValue from a dict
get_person_presence200_response_data_by_channel_value_from_dict = GetPersonPresence200ResponseDataByChannelValue.from_dict(get_person_presence200_response_data_by_channel_value_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


