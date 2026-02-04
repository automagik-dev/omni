# GetHealth200ResponseChecks


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**database** | [**GetHealth200ResponseChecksDatabase**](GetHealth200ResponseChecksDatabase.md) |  | 
**nats** | [**GetHealth200ResponseChecksDatabase**](GetHealth200ResponseChecksDatabase.md) |  | 

## Example

```python
from omni_generated.models.get_health200_response_checks import GetHealth200ResponseChecks

# TODO update the JSON string below
json = "{}"
# create an instance of GetHealth200ResponseChecks from a JSON string
get_health200_response_checks_instance = GetHealth200ResponseChecks.from_json(json)
# print the JSON string representation of the object
print(GetHealth200ResponseChecks.to_json())

# convert the object into a dict
get_health200_response_checks_dict = get_health200_response_checks_instance.to_dict()
# create an instance of GetHealth200ResponseChecks from a dict
get_health200_response_checks_from_dict = GetHealth200ResponseChecks.from_dict(get_health200_response_checks_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


