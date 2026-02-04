# GetPersonPresence200ResponseData


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**person** | [**SearchPersons200ResponseItemsInner**](SearchPersons200ResponseItemsInner.md) |  | 
**identities** | [**List[GetPersonPresence200ResponseDataIdentitiesInner]**](GetPersonPresence200ResponseDataIdentitiesInner.md) |  | 
**summary** | [**GetPersonPresence200ResponseDataSummary**](GetPersonPresence200ResponseDataSummary.md) |  | 
**by_channel** | [**Dict[str, GetPersonPresence200ResponseDataByChannelValue]**](GetPersonPresence200ResponseDataByChannelValue.md) |  | 

## Example

```python
from omni_generated.models.get_person_presence200_response_data import GetPersonPresence200ResponseData

# TODO update the JSON string below
json = "{}"
# create an instance of GetPersonPresence200ResponseData from a JSON string
get_person_presence200_response_data_instance = GetPersonPresence200ResponseData.from_json(json)
# print the JSON string representation of the object
print(GetPersonPresence200ResponseData.to_json())

# convert the object into a dict
get_person_presence200_response_data_dict = get_person_presence200_response_data_instance.to_dict()
# create an instance of GetPersonPresence200ResponseData from a dict
get_person_presence200_response_data_from_dict = GetPersonPresence200ResponseData.from_dict(get_person_presence200_response_data_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


